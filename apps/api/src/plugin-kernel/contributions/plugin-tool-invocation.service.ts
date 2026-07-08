import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import Ajv from 'ajv';
import {
  pluginOperationNameSchema,
  type PluginRuntimeJsonValue,
  type ToolContribution,
} from '@nexus/plugin-sdk';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginEventPublisherService } from '../events/plugin-event-publisher.service';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type { PluginContributionInventoryEntry } from './plugin-contribution.types';

const DEFAULT_OPERATION = 'execute';
const DEFAULT_ACTOR_ID = 'plugin-tool-bridge';
const PLUGIN_TOOL_NAME_PREFIX = 'plugin:';

interface PluginToolInvocationRequest {
  readonly pluginId: string;
  readonly version: string;
  readonly contributionId: string;
  readonly input: unknown;
  readonly actorId?: string;
}

interface PluginToolInvocationOptions {
  readonly version?: string;
  readonly actorId?: string;
}

type PluginToolInvocationResult =
  | { readonly ok: true; readonly output?: PluginRuntimeJsonValue }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

@Injectable()
export class PluginToolInvocationService {
  private readonly ajv = new Ajv({ validateSchema: false });

  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
    private readonly runtimeManager: PluginRuntimeManagerService,
    @Optional()
    private readonly pluginEventPublisher?: PluginEventPublisherService,
  ) {}

  async invokeByToolName(
    toolName: string,
    input: unknown,
    options: PluginToolInvocationOptions = {},
  ): Promise<PluginToolInvocationResult> {
    if (!toolName.startsWith(PLUGIN_TOOL_NAME_PREFIX)) {
      return this.error(
        'invalid_plugin_tool_name',
        'Plugin tool name is invalid.',
        false,
      );
    }

    let entries: PluginContributionInventoryEntry[];
    try {
      entries =
        await this.contributionRegistry.findContributionsByGlobalCapabilityName(
          toolName,
          options.version,
        );
    } catch {
      return this.unavailable();
    }

    if (entries.length > 1) {
      return this.ambiguous();
    }

    return this.invokeResolvedEntry(entries[0] ?? null, input, options.actorId);
  }

  async invokeByContribution(
    request: PluginToolInvocationRequest,
  ): Promise<PluginToolInvocationResult> {
    let entry: PluginContributionInventoryEntry | null;
    try {
      entry = await this.contributionRegistry.findContributionByVersion(
        request.pluginId,
        request.version,
        request.contributionId,
      );
    } catch {
      return this.unavailable();
    }

    return this.invokeResolvedEntry(entry, request.input, request.actorId);
  }

  private async invokeResolvedEntry(
    entry: PluginContributionInventoryEntry | null,
    input: unknown,
    actorId?: string,
  ): Promise<PluginToolInvocationResult> {
    if (!entry || !this.isAvailable(entry)) {
      return this.unavailable();
    }

    if (entry.type !== 'tool') {
      return this.error(
        'not_plugin_tool',
        'Plugin contribution is not a tool.',
        false,
      );
    }

    const contribution = this.getToolContribution(entry.contribution);
    if (!contribution) {
      return this.unavailable();
    }

    if (!this.isValidInput(contribution, input)) {
      return this.error(
        'invalid_tool_input',
        'Tool input did not match plugin contribution schema.',
        false,
      );
    }

    try {
      const result = await this.runtimeManager.invokePlugin({
        pluginId: entry.pluginId,
        version: entry.version,
        contributionId: entry.contributionId,
        operation: this.getOperation(contribution),
        input,
        actorId: actorId ?? DEFAULT_ACTOR_ID,
      });

      if (result.ok) {
        await this.publishToolInvokedBestEffort(entry, actorId);
        return { ok: true, output: result.output };
      }

      return this.error(
        'plugin_tool_runtime_failed',
        'Plugin tool invocation failed.',
        result.error.retryable,
      );
    } catch {
      return this.error(
        'plugin_tool_runtime_failed',
        'Plugin tool invocation failed.',
        true,
      );
    }
  }

  private isAvailable(entry: PluginContributionInventoryEntry): boolean {
    return entry.lastValidationResult.status === 'valid';
  }

  private getToolContribution(contribution: unknown): ToolContribution | null {
    if (typeof contribution !== 'object' || contribution === null) {
      return null;
    }

    const contributionRecord = contribution as Record<string, unknown>;
    const config = contributionRecord.config;
    if (typeof config !== 'object' || config === null) {
      return null;
    }

    const configRecord = config as Record<string, unknown>;
    if (
      contributionRecord.type !== 'tool' ||
      typeof configRecord.inputSchema !== 'object' ||
      configRecord.inputSchema === null
    ) {
      return null;
    }

    return contribution as ToolContribution;
  }

  private isValidInput(
    contribution: ToolContribution,
    input: unknown,
  ): boolean {
    try {
      const validate = this.ajv.compile(contribution.config.inputSchema);
      const validationResult = validate(input) as unknown;
      return typeof validationResult === 'boolean' ? validationResult : false;
    } catch {
      return false;
    }
  }

  private getOperation(contribution: ToolContribution): string {
    const result = pluginOperationNameSchema.safeParse(
      contribution.config.operation,
    );
    return result.success ? result.data : DEFAULT_OPERATION;
  }

  private unavailable(): PluginToolInvocationResult {
    return this.error(
      'plugin_tool_unavailable',
      'Plugin tool is unavailable.',
      false,
    );
  }

  private ambiguous(): PluginToolInvocationResult {
    return this.error(
      'plugin_tool_ambiguous',
      'Plugin tool version is ambiguous.',
      false,
    );
  }

  private error(
    code: string,
    message: string,
    retryable: boolean,
  ): PluginToolInvocationResult {
    return {
      ok: false,
      error: { code, message, retryable },
    };
  }

  private async publishToolInvokedBestEffort(
    entry: PluginContributionInventoryEntry,
    actorId?: string,
  ): Promise<void> {
    if (!this.pluginEventPublisher) {
      return;
    }

    try {
      await this.pluginEventPublisher.publishToolInvokedEvent({
        toolName: entry.globalCapabilityName,
        invocationId: randomUUID(),
        pluginId: entry.pluginId,
        contributionId: entry.contributionId,
        version: entry.version,
        correlationId: actorId,
      });
    } catch {
      // Best-effort event publishing must not fail tool invocation results.
    }
  }
}
