import { ConflictException, Injectable } from '@nestjs/common';
import type { IToolRegistry } from '@nexus/core';
import {
  toolContributionSchema,
  type ToolContribution,
} from '@nexus/plugin-sdk';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionCleanupRequest,
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';
import type {
  BasePluginToolProjectionResult,
  FailedPluginToolResult,
  PluginToolProjectionResult,
} from './plugin-tool-projection.types';

const PLUGIN_TOOL_TIER_RESTRICTION = 0;
const API_GLOBAL_PREFIX = '/api';
// Intentionally inert: api_callback transport executes the plugin; source exists
// to satisfy tool registry requirements.
const BRIDGE_TOOL_CODE = `// plugin kernel bridge
export async function execute(input: unknown): Promise<unknown> {
  return input;
}
`;

@Injectable()
export class PluginToolProjectionService {
  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async projectEnabledTools(): Promise<PluginToolProjectionResult[]> {
    const contributions =
      await this.contributionRegistry.listActiveContributionProjectionEntries();
    const results: PluginToolProjectionResult[] = [];

    for (const entry of contributions) {
      results.push(await this.projectContribution(entry));
    }

    return results;
  }

  async cleanupPluginTools(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginToolProjectionResult[]> {
    const candidates =
      await this.contributionRegistry.calculateCleanupProjectionCandidates(
        request,
      );
    const results: PluginToolProjectionResult[] = [];

    for (const candidate of candidates) {
      results.push(await this.cleanupCandidate(candidate));
    }

    return results;
  }

  private async projectContribution(
    entry: PluginContributionProjectionInventoryEntry,
  ): Promise<PluginToolProjectionResult> {
    const base = this.toBaseResult(entry);

    if (entry.lastValidationResult.status === 'invalid') {
      return {
        ...base,
        status: 'failed',
        reason: 'invalid_contribution',
        errorMessage: entry.lastValidationResult.errorMessage,
      };
    }

    if (!this.isValidInventoryEntry(entry)) {
      return {
        ...base,
        status: 'failed',
        reason: 'invalid_contribution',
        errorMessage: 'Invalid contribution projection entry',
      };
    }

    if (entry.type !== 'tool') {
      return { ...base, status: 'skipped', reason: 'not_tool' };
    }

    const parsed = toolContributionSchema.safeParse(entry.contribution);
    if (!parsed.success) {
      return {
        ...base,
        status: 'failed',
        reason: 'invalid_contribution',
        errorMessage: parsed.error.message,
      };
    }

    try {
      const tool = await this.toolRegistry.upsertTool(
        this.toToolPayload(entry, parsed.data),
      );
      return { ...base, status: 'projected', toolId: tool.id };
    } catch (error) {
      if (error instanceof ConflictException) {
        return {
          ...base,
          status: 'conflict',
          reason: 'tool_registry_conflict',
          errorMessage: error.message,
        };
      }

      return {
        ...base,
        status: 'failed',
        reason: 'tool_registry_error',
        errorMessage: (error as Error).message,
      };
    }
  }

  private async cleanupCandidate(
    candidate: PluginContributionProjectionInventoryEntry,
  ): Promise<PluginToolProjectionResult> {
    const base = this.toBaseResult(candidate);

    if (candidate.lastValidationResult.status === 'invalid') {
      if (candidate.type === 'tool') {
        return this.cleanupToolProjection(candidate);
      }

      return this.invalidCleanupResult(
        base,
        candidate.lastValidationResult.errorMessage,
      );
    }

    if (!this.isValidInventoryEntry(candidate)) {
      return this.invalidCleanupResult(
        base,
        'Invalid contribution cleanup entry',
      );
    }

    if (candidate.type !== 'tool') {
      return { ...base, status: 'skipped', reason: 'not_tool' };
    }

    return this.cleanupToolProjection(candidate);
  }

  private async cleanupToolProjection(
    candidate: Pick<
      PluginContributionProjectionInventoryEntry,
      'globalCapabilityName' | 'pluginId' | 'version' | 'contributionId'
    >,
  ): Promise<PluginToolProjectionResult> {
    const base = this.toBaseResult(candidate);
    try {
      const deleteResult = await this.toolRegistry.deletePluginProjectionTool({
        name: candidate.globalCapabilityName,
        apiCallbackPath: this.toInvocationPath(candidate),
      });

      if (deleteResult.status === 'deleted') {
        return { ...base, status: 'projected' };
      }

      if (deleteResult.status === 'skipped') {
        return { ...base, status: 'skipped', reason: 'not_found' };
      }

      return {
        ...base,
        status: 'conflict',
        reason: 'tool_registry_conflict',
        errorMessage: deleteResult.errorMessage,
      };
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        reason: 'cleanup_error',
        errorMessage: (error as Error).message,
      };
    }
  }

  private invalidCleanupResult(
    base: BasePluginToolProjectionResult,
    errorMessage: string,
  ): FailedPluginToolResult {
    return {
      ...base,
      status: 'failed',
      reason: 'invalid_contribution',
      errorMessage,
    };
  }

  private toToolPayload(
    entry: PluginContributionInventoryEntry,
    contribution: ToolContribution,
  ): Partial<IToolRegistry> {
    return {
      name: entry.globalCapabilityName,
      schema: contribution.config.inputSchema,
      typescript_code: BRIDGE_TOOL_CODE,
      tier_restriction: PLUGIN_TOOL_TIER_RESTRICTION,
      runtime_owner: 'api',
      transport: 'api_callback',
      api_callback: {
        method: 'POST',
        path_template: this.toInvocationPath(entry),
        inject_scope_id: false,
      },
      language: 'node',
      publication_status: 'published',
    };
  }

  private toInvocationPath(
    entry: Pick<
      PluginContributionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
  ): string {
    return `${API_GLOBAL_PREFIX}/plugins/${this.encodePathSegment(entry.pluginId)}/${this.encodePathSegment(entry.version)}/contributions/${this.encodePathSegment(entry.contributionId)}/invoke`;
  }

  private encodePathSegment(value: string): string {
    return encodeURIComponent(value);
  }

  private toBaseResult(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId' | 'globalCapabilityName'
    >,
  ): BasePluginToolProjectionResult {
    return {
      status: 'projected',
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      toolName: entry.globalCapabilityName,
    };
  }

  private isValidInventoryEntry(
    entry: PluginContributionProjectionInventoryEntry,
  ): entry is PluginContributionInventoryEntry {
    return entry.lastValidationResult.status === 'valid';
  }
}
