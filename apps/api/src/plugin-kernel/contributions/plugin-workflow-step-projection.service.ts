import { Injectable } from '@nestjs/common';
import {
  workflowStepContributionSchema,
  type WorkflowStepContribution,
} from '@nexus/plugin-sdk';
import { StepSpecialStepRegistryService } from '../../workflow/workflow-special-steps/step-special-step-registry.service';
import {
  isCoreSpecialStepType,
  isReservedSpecialStepType,
} from '../../workflow/workflow-special-steps/step-special-step.types';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionCleanupRequest,
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';
import { PluginWorkflowStepHandler } from './plugin-workflow-step.handler';
import type {
  BasePluginWorkflowStepProjectionResult,
  FailedPluginWorkflowStepResult,
  PluginWorkflowStepProjectionResult,
} from './plugin-workflow-step-projection.types';

@Injectable()
export class PluginWorkflowStepProjectionService {
  private readonly projectedKeys = new Set<string>();

  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
    private readonly specialStepRegistry: StepSpecialStepRegistryService,
    private readonly runtimeManager: PluginRuntimeManagerService,
  ) {}

  async projectEnabledWorkflowSteps(): Promise<
    PluginWorkflowStepProjectionResult[]
  > {
    const entries =
      await this.contributionRegistry.listActiveContributionProjectionEntries();
    const results: PluginWorkflowStepProjectionResult[] = [];

    for (const entry of entries) {
      results.push(this.projectContribution(entry));
    }

    return results;
  }

  async cleanupPluginWorkflowSteps(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginWorkflowStepProjectionResult[]> {
    const candidates =
      await this.contributionRegistry.calculateCleanupProjectionCandidates(
        request,
      );
    const results: PluginWorkflowStepProjectionResult[] = [];

    for (const candidate of candidates) {
      results.push(this.cleanupCandidate(candidate));
    }

    return results;
  }

  private projectContribution(
    entry: PluginContributionProjectionInventoryEntry,
  ): PluginWorkflowStepProjectionResult {
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
      return this.invalidProjectionResult(
        base,
        'Invalid contribution projection entry',
      );
    }

    if (entry.type !== 'workflow.step') {
      return { ...base, status: 'skipped', reason: 'not_workflow_step' };
    }

    const parsed = workflowStepContributionSchema.safeParse(entry.contribution);
    if (!parsed.success) {
      return this.invalidProjectionResult(base, parsed.error.message);
    }

    const contribution = parsed.data;
    const stepType = this.toStepType(entry, contribution);
    const resultBase = { ...base, stepType };

    if (
      isCoreSpecialStepType(stepType) ||
      isReservedSpecialStepType(stepType)
    ) {
      return {
        ...resultBase,
        status: 'conflict',
        reason: 'reserved_or_core_step_type',
      };
    }

    const projectionKey = this.toProjectionKey(entry, stepType);
    if (this.registryHasProjectedHandler(stepType, entry)) {
      this.projectedKeys.add(projectionKey);
      return { ...resultBase, status: 'projected' };
    }

    try {
      const handler = new PluginWorkflowStepHandler(
        {
          pluginId: entry.pluginId,
          version: entry.version,
          contributionId: entry.contributionId,
          globalCapabilityName: stepType,
          contribution,
        },
        this.runtimeManager,
      );
      this.specialStepRegistry.registerPluginHandler(handler);
      this.projectedKeys.add(projectionKey);
      return { ...resultBase, status: 'projected' };
    } catch (error) {
      return {
        ...resultBase,
        status: 'conflict',
        reason: 'step_registry_conflict',
        errorMessage: (error as Error).message,
      };
    }
  }

  private cleanupCandidate(
    candidate: PluginContributionProjectionInventoryEntry,
  ): PluginWorkflowStepProjectionResult {
    const base = this.toBaseResult(candidate);

    if (candidate.lastValidationResult.status === 'invalid') {
      if (candidate.type === 'workflow.step') {
        return this.cleanupWorkflowStepProjection(candidate, base);
      }

      return this.invalidProjectionResult(
        base,
        candidate.lastValidationResult.errorMessage,
      );
    }

    if (!this.isValidInventoryEntry(candidate)) {
      return this.invalidProjectionResult(
        base,
        'Invalid contribution cleanup entry',
      );
    }

    if (candidate.type !== 'workflow.step') {
      return { ...base, status: 'skipped', reason: 'not_workflow_step' };
    }

    return this.cleanupWorkflowStepProjection(candidate, base);
  }

  private cleanupWorkflowStepProjection(
    candidate: PluginContributionProjectionInventoryEntry,
    base: BasePluginWorkflowStepProjectionResult,
  ): PluginWorkflowStepProjectionResult {
    const stepType = this.getStepType(candidate);
    const resultBase = { ...base, stepType };

    try {
      const removed = this.specialStepRegistry.unregisterPluginHandler(
        stepType,
        {
          pluginId: candidate.pluginId,
          version: candidate.version,
          contributionId: candidate.contributionId,
        },
      );
      this.projectedKeys.delete(this.toProjectionKey(candidate, stepType));

      if (!removed) {
        return { ...resultBase, status: 'skipped', reason: 'not_found' };
      }

      return { ...resultBase, status: 'cleaned' };
    } catch (error) {
      return {
        ...resultBase,
        status: 'failed',
        reason: 'cleanup_error',
        errorMessage: (error as Error).message,
      };
    }
  }

  private invalidProjectionResult(
    base: BasePluginWorkflowStepProjectionResult,
    errorMessage: string,
  ): FailedPluginWorkflowStepResult {
    return {
      ...base,
      status: 'failed',
      reason: 'invalid_contribution',
      errorMessage,
    };
  }

  private toBaseResult(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId' | 'globalCapabilityName'
    >,
  ): BasePluginWorkflowStepProjectionResult {
    return {
      status: 'projected',
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      stepType: entry.globalCapabilityName,
    };
  }

  private toStepType(
    entry: PluginContributionInventoryEntry,
    contribution: WorkflowStepContribution,
  ): string {
    return contribution.config.stepType || entry.globalCapabilityName;
  }

  private getStepType(
    candidate: PluginContributionProjectionInventoryEntry,
  ): string {
    if (
      typeof candidate.contribution === 'object' &&
      candidate.contribution !== null &&
      'config' in candidate.contribution &&
      typeof candidate.contribution.config === 'object' &&
      candidate.contribution.config !== null &&
      'stepType' in candidate.contribution.config &&
      typeof candidate.contribution.config.stepType === 'string'
    ) {
      return candidate.contribution.config.stepType;
    }

    return candidate.globalCapabilityName;
  }

  private toProjectionKey(
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
    stepType: string,
  ): string {
    return `${entry.pluginId}\u0000${entry.version}\u0000${entry.contributionId}\u0000${stepType}`;
  }

  private registryHasProjectedHandler(
    stepType: string,
    entry: Pick<
      PluginContributionProjectionInventoryEntry,
      'pluginId' | 'version' | 'contributionId'
    >,
  ): boolean {
    const handler = this.specialStepRegistry.getHandler(stepType);
    return (
      handler?.descriptor.owningDomain === 'plugin' &&
      handler.descriptor.pluginId === entry.pluginId &&
      handler.descriptor.pluginVersion === entry.version &&
      handler.descriptor.contributionId === entry.contributionId
    );
  }

  private isValidInventoryEntry(
    entry: PluginContributionProjectionInventoryEntry,
  ): entry is PluginContributionInventoryEntry {
    return entry.lastValidationResult.status === 'valid';
  }
}
