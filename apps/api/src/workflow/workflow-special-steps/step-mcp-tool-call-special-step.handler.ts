import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createCallToolRequest,
  parseJsonRpcResponse,
  parseToolCallResult,
} from '../../mcp/mcp-jsonrpc.utils';
import { McpService } from '../../mcp/mcp.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { getErrorMessage, readString } from '@nexus/core';
import {
  asRecord,
  isAllowedByPatterns,
  requireNonEmptyString,
  requireStringArray,
  resolveTimeoutMs,
  withTimeout,
} from './special-step-policy.helpers';
import { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

interface ExternalMcpMount {
  id: string;
  serverId?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface McpToolCallResponse {
  server_id: string;
  remote_tool_name: string;
  registry_tool_name?: string;
  duration_ms: number;
  result: Record<string, unknown> | unknown[];
}

@Injectable()
export class StepMcpToolCallSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'mcp_tool_call' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract:
      'inputs.server_id + inputs.tool_name + inputs.policy.allowed_servers + inputs.policy.allowed_tools',
  } as const;

  private readonly logger = new Logger(StepMcpToolCallSpecialStepHandler.name);

  constructor(
    private readonly mcpService: McpService,
    private readonly auditPublisher: SpecialStepAuditPublisher,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const serverId = requireNonEmptyString(
      resolvedStepInputs,
      'server_id',
      stepId,
      this.type,
    );
    const toolName = requireNonEmptyString(
      resolvedStepInputs,
      'tool_name',
      stepId,
      this.type,
    );
    const policy = asRecord(resolvedStepInputs.policy);
    const allowedServers = requireStringArray(
      policy,
      'allowed_servers',
      stepId,
      this.type,
    );
    const allowedTools = requireStringArray(
      policy,
      'allowed_tools',
      stepId,
      this.type,
    );

    if (!isAllowedByPatterns(serverId, allowedServers)) {
      const message = `Step ${stepId}: mcp_tool_call server '${serverId}' is not allowed by policy`;
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'blocked',
        workflowRunId,
        stepId,
        payload: { server_id: serverId, tool_name: toolName },
        errorMessage: message,
      });
      throw new Error(message);
    }

    if (!isAllowedByPatterns(toolName, allowedTools)) {
      const message = `Step ${stepId}: mcp_tool_call tool '${toolName}' is not allowed by policy`;
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'blocked',
        workflowRunId,
        stepId,
        payload: { server_id: serverId, tool_name: toolName },
        errorMessage: message,
      });
      throw new Error(message);
    }

    const params = asRecord(resolvedStepInputs.params) ?? {};
    const timeoutMs = resolveTimeoutMs(
      resolvedStepInputs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    try {
      const externalMount = await this.findExternalUrlMount(
        workflowRunId,
        serverId,
      );
      const responsePromise: Promise<McpToolCallResponse> = externalMount
        ? this.invokeExternalMount(externalMount, serverId, toolName, params)
        : this.mcpService.invokeTool(serverId, toolName, params);
      const response = await withTimeout(
        responsePromise,
        timeoutMs,
        `mcp_tool_call timed out after ${timeoutMs}ms`,
      );
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'succeeded',
        workflowRunId,
        stepId,
        payload: { server_id: serverId, tool_name: toolName },
      });
      this.logger.log(`mcp_tool_call [${stepId}]: ${serverId}/${toolName}`);

      return {
        result: {
          status: 'completed',
          mode: 'mcp_tool_call',
          serverId,
          toolName,
        },
        output: {
          ok: true,
          stepId,
          server_id: response.server_id,
          remote_tool_name: response.remote_tool_name,
          registry_tool_name: response.registry_tool_name,
          duration_ms: response.duration_ms,
          result: response.result,
          timed_out: false,
        },
      };
    } catch (error) {
      const message = getErrorMessage(error);
      await this.auditPublisher.audit({
        type: this.type,
        outcome: 'failed',
        workflowRunId,
        stepId,
        payload: { server_id: serverId, tool_name: toolName },
        errorMessage: message,
      });
      this.logger.warn(`mcp_tool_call [${stepId}]: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async findExternalUrlMount(
    workflowRunId: string,
    serverId: string,
  ): Promise<ExternalMcpMount | undefined> {
    const run = await this.runRepo.findById(workflowRunId);
    const stateVariables = asRecord(run?.state_variables) ?? {};
    const trigger = asRecord(stateVariables.trigger);
    const rawMounts = Array.isArray(trigger?.externalMcpMounts)
      ? trigger.externalMcpMounts
      : Array.isArray(stateVariables.externalMcpMounts)
        ? stateVariables.externalMcpMounts
        : [];

    return rawMounts
      .map((mount) => this.toExternalMcpMount(mount))
      .find(
        (mount): mount is ExternalMcpMount =>
          mount !== null &&
          Boolean(mount.url) &&
          (mount.id === serverId || mount.serverId === serverId),
      );
  }

  private toExternalMcpMount(value: unknown): ExternalMcpMount | null {
    const record = asRecord(value);
    const id =
      this.readString(record, 'id') ?? this.readString(record, 'serverId');
    if (!id) {
      return null;
    }

    return {
      id,
      ...(this.readString(record, 'serverId')
        ? { serverId: this.readString(record, 'serverId') as string }
        : {}),
      ...(this.readString(record, 'url')
        ? { url: this.readString(record, 'url') as string }
        : {}),
      ...(this.readStringRecord(record?.headers)
        ? {
            headers: this.readStringRecord(record?.headers) as Record<
              string,
              string
            >,
          }
        : {}),
    };
  }

  private async invokeExternalMount(
    mount: ExternalMcpMount,
    serverId: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolCallResponse> {
    if (!mount.url) {
      throw new Error(`External MCP mount '${mount.id}' is missing url`);
    }

    const startedAt = Date.now();
    const response = await fetch(mount.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(mount.headers ?? {}),
      },
      body: JSON.stringify(createCallToolRequest(1, toolName, params)),
    });

    if (!response.ok) {
      throw new Error(
        `External MCP HTTP request failed with status ${String(response.status)}`,
      );
    }

    const responseText = await response.text();
    const payload: unknown = responseText ? JSON.parse(responseText) : {};
    const parsed = parseJsonRpcResponse(payload);
    if (parsed.error) {
      throw new Error(
        `External MCP tool call failed (${String(parsed.error.code)}): ${parsed.error.message}`,
      );
    }
    if (parsed.result === undefined) {
      throw new Error('External MCP response did not include result');
    }

    const result = parseToolCallResult(parsed.result);
    return {
      server_id: serverId,
      remote_tool_name: toolName,
      duration_ms: Date.now() - startedAt,
      result: result.result,
    };
  }

  private readString(
    record: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const trimmed = readString(record?.[key])?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  private readStringRecord(value: unknown): Record<string, string> | undefined {
    const record = asRecord(value);
    if (!record) {
      return undefined;
    }

    const entries = Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
}
