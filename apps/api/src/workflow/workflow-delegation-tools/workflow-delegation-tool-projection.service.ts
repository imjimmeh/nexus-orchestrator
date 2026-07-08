import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { asRecord, type IToolRegistry } from '@nexus/core';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CapabilityRegistrarService } from '../../tool-registry/capability-registrar.service';
import { WorkflowRuntimeOrchestrationActionsService } from '../workflow-runtime/workflow-runtime-orchestration-actions.service';
import {
  WorkflowRuntimeAwaitActionsService,
  isOrchestrationAwaitEnabled,
} from '../workflow-runtime/workflow-runtime-await-actions.service';
import type {
  WorkflowDelegationProjectionResult,
  WorkflowDelegationToolConfigFile,
  WorkflowDelegationToolDefinition,
} from './workflow-delegation-tool-projection.types';

const BRIDGE_TOOL_CODE = `// workflow delegation projection bridge
export async function execute(input: unknown): Promise<unknown> {
  return input;
}
`;
const API_GLOBAL_PREFIX = '/api';
const CONTROL_FIELDS = new Set([
  'workflow_id',
  'workflow_run_id',
  'agent_profile',
  'reason',
  'reasoning',
  'task_prompt',
  'message',
  'objective',
  'trigger_data',
]);

@Injectable()
export class WorkflowDelegationToolProjectionService implements OnModuleInit {
  private readonly logger = new Logger(
    WorkflowDelegationToolProjectionService.name,
  );
  private definitionsByToolName = new Map<
    string,
    WorkflowDelegationToolDefinition
  >();

  constructor(
    private readonly registrar: CapabilityRegistrarService,
    private readonly orchestrationActions: WorkflowRuntimeOrchestrationActionsService,
    private readonly awaitActions: WorkflowRuntimeAwaitActionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.projectEnabledTools();
  }

  async projectEnabledTools(): Promise<WorkflowDelegationProjectionResult[]> {
    const definitions = this.loadDefinitions();
    this.definitionsByToolName = new Map(
      definitions
        .filter(
          (definition) =>
            definition.enabled !== false &&
            !(
              definition.feature_flag &&
              process.env[definition.feature_flag] !== 'true'
            ),
        )
        .map((definition) => [definition.tool_name, definition]),
    );
    const results: WorkflowDelegationProjectionResult[] = [];

    for (const definition of definitions) {
      if (definition.enabled === false) {
        results.push({
          toolName: definition.tool_name,
          workflowId: definition.workflow_id,
          status: 'skipped',
          reason: 'disabled',
        });
        continue;
      }

      if (
        definition.feature_flag &&
        process.env[definition.feature_flag] !== 'true'
      ) {
        results.push({
          toolName: definition.tool_name,
          workflowId: definition.workflow_id,
          status: 'skipped',
          reason: 'feature_flag_disabled',
        });
        continue;
      }

      try {
        await this.registrar.registerToolProjection({
          tool: this.toToolPayload(definition),
          source: 'manual',
          sourceMetadata: this.toProjectionMetadata(definition),
        });
        results.push({
          toolName: definition.tool_name,
          workflowId: definition.workflow_id,
          status: 'projected',
        });
      } catch (error) {
        this.logger.warn(
          `Workflow delegation projection failed for ${definition.tool_name}: ${(error as Error).message}`,
        );
        results.push({
          toolName: definition.tool_name,
          workflowId: definition.workflow_id,
          status: 'failed',
          errorMessage: (error as Error).message,
        });
      }
    }

    return results;
  }

  async invokeProjectedDelegation(
    toolName: string,
    body: Record<string, unknown>,
    workflowRunId?: string,
    stepId?: string,
  ): Promise<Record<string, unknown>> {
    const definition =
      this.definitionsByToolName.get(toolName) ??
      this.loadDefinitions().find(
        (candidate) =>
          candidate.tool_name === toolName &&
          candidate.enabled !== false &&
          !(
            candidate.feature_flag &&
            process.env[candidate.feature_flag] !== 'true'
          ),
      );
    if (!definition) {
      throw new NotFoundException(
        `Projected workflow delegation tool ${toolName} is not configured`,
      );
    }

    this.definitionsByToolName.set(toolName, definition);

    // Prefer durable await so the calling orchestration step suspends until the
    // delegated child completes — otherwise the next cycle advances blind to
    // in-flight (or failed) delegations. Falls back to fire-and-forget when the
    // feature is disabled or the calling run/step is unknown (no step to park).
    if (isOrchestrationAwaitEnabled() && workflowRunId && stepId) {
      const awaited = await this.awaitActions.startAwaitedInvocationWorkflows({
        workflow_id: definition.workflow_id,
        ...(definition.agent_profile
          ? { agent_profile: definition.agent_profile }
          : {}),
        workflow_run_id: workflowRunId,
        step_id: stepId,
        inputs: {
          ...this.buildTriggerData(definition, body),
          ...this.pickStringFields(body, [
            'reason',
            'reasoning',
            'task_prompt',
            'message',
            'objective',
          ]),
        },
      });
      return { ...awaited };
    }

    return this.orchestrationActions.invokeAgentWorkflow({
      workflow_id: definition.workflow_id,
      ...(definition.agent_profile
        ? { agent_profile: definition.agent_profile }
        : {}),
      ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
      ...this.pickStringFields(body, [
        'reason',
        'reasoning',
        'task_prompt',
        'message',
        'objective',
      ]),
      trigger_data: this.buildTriggerData(definition, body),
    });
  }

  private toToolPayload(
    definition: WorkflowDelegationToolDefinition,
  ): Partial<IToolRegistry> {
    return {
      name: definition.tool_name,
      description: definition.description,
      metadata: this.toProjectionMetadata(definition),
      schema: definition.input_schema,
      typescript_code: BRIDGE_TOOL_CODE,
      tier_restriction: definition.tier_restriction ?? 1,
      runtime_owner: 'api',
      transport: 'api_callback',
      api_callback: {
        method: 'POST',
        path_template: this.toInvocationPath(definition.tool_name),
        body_mapping: this.buildBodyMapping(definition.input_schema),
        inject_scope_id: false,
      },
      language: 'node',
      publication_status: 'published',
    };
  }

  private toProjectionMetadata(
    definition: WorkflowDelegationToolDefinition,
  ): Record<string, unknown> {
    return {
      source: 'workflow_delegation_projection',
      projection_id: definition.id,
      workflow_id: definition.workflow_id,
    };
  }

  private toInvocationPath(toolName: string): string {
    return `${API_GLOBAL_PREFIX}/workflow-runtime/orchestration/projected-workflow-delegations/${encodeURIComponent(toolName)}/invoke`;
  }

  private buildBodyMapping(
    schema: Record<string, unknown>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.keys(asRecord(schema.properties)).map((key) => [key, key]),
    );
  }

  private buildTriggerData(
    definition: WorkflowDelegationToolDefinition,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const triggerData = this.withoutControlFields(asRecord(body.trigger_data));
    const fields =
      definition.trigger_data_fields ??
      Object.keys(body).filter((key) => !CONTROL_FIELDS.has(key));

    for (const field of fields) {
      if (body[field] !== undefined) {
        triggerData[field] = body[field];
      }
    }

    return { ...triggerData, ...(definition.fixed_trigger_data ?? {}) };
  }

  private pickStringFields(
    body: Record<string, unknown>,
    keys: string[],
  ): Record<string, string> {
    return Object.fromEntries(
      keys
        .map((key) => [key, body[key]])
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].trim().length > 0,
        )
        .map(([key, value]) => [key, value.trim()]),
    );
  }

  private withoutControlFields(
    record: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).filter(([key]) => !CONTROL_FIELDS.has(key)),
    );
  }

  private loadDefinitions(): WorkflowDelegationToolDefinition[] {
    const seedDir =
      process.env.WORKFLOW_DELEGATION_TOOLS_SEED_DIR?.trim() ||
      path.resolve(process.cwd(), 'seed', 'workflow-delegation-tools');
    if (!existsSync(seedDir)) {
      return [];
    }

    return readdirSync(seedDir)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => this.parseConfigFile(path.join(seedDir, file)).tools);
  }

  private parseConfigFile(filePath: string): WorkflowDelegationToolConfigFile {
    return JSON.parse(
      readFileSync(filePath, 'utf8'),
    ) as WorkflowDelegationToolConfigFile;
  }
}
