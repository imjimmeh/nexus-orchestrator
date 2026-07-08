import { Injectable } from '@nestjs/common';
import type { PluginContributionCleanupRequest } from './plugin-contribution.types';
import { PluginToolProjectionService } from './plugin-tool-projection.service';
import { PluginWorkflowHookProjectionService } from './plugin-workflow-hook-projection.service';
import { PluginWorkflowStepProjectionService } from './plugin-workflow-step-projection.service';
import { PluginEventSubscriptionProjectionService } from '../events/plugin-event-subscription-projection.service';
import type {
  AdapterProjectionResult,
  PluginProjectionOrchestrationError,
  PluginProjectionOrchestrationResult,
  ProjectionAction,
  ProjectionAdapterName,
} from './plugin-projection-orchestrator.types';

@Injectable()
export class PluginProjectionOrchestratorService {
  constructor(
    private readonly toolProjection: PluginToolProjectionService,
    private readonly workflowStepProjection: PluginWorkflowStepProjectionService,
    private readonly workflowHookProjection: PluginWorkflowHookProjectionService,
    private readonly eventSubscriptionProjection: PluginEventSubscriptionProjectionService,
  ) {}

  async refreshProjectedContributions(): Promise<PluginProjectionOrchestrationResult> {
    const results = this.emptyResults();
    const errors: PluginProjectionOrchestrationError[] = [];

    await this.collectAdapterResult({
      action: 'refresh',
      adapter: 'tools',
      results,
      errors,
      run: () => this.toolProjection.projectEnabledTools(),
    });
    await this.collectAdapterResult({
      action: 'refresh',
      adapter: 'workflowSteps',
      results,
      errors,
      run: () => this.workflowStepProjection.projectEnabledWorkflowSteps(),
    });
    await this.collectAdapterResult({
      action: 'refresh',
      adapter: 'workflowHooks',
      results,
      errors,
      run: () => this.workflowHookProjection.projectEnabledWorkflowHooks(),
    });
    await this.collectAdapterResult({
      action: 'refresh',
      adapter: 'eventSubscriptions',
      results,
      errors,
      run: () =>
        this.eventSubscriptionProjection.projectEnabledEventSubscriptions(),
    });

    return { ok: errors.length === 0, action: 'refresh', results, errors };
  }

  async cleanupProjectedContributions(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginProjectionOrchestrationResult> {
    const results = this.emptyResults();
    const errors: PluginProjectionOrchestrationError[] = [];

    await this.collectAdapterResult({
      action: 'cleanup',
      adapter: 'tools',
      results,
      errors,
      run: () => this.toolProjection.cleanupPluginTools(request),
    });
    await this.collectAdapterResult({
      action: 'cleanup',
      adapter: 'workflowSteps',
      results,
      errors,
      run: () =>
        this.workflowStepProjection.cleanupPluginWorkflowSteps(request),
    });
    await this.collectAdapterResult({
      action: 'cleanup',
      adapter: 'workflowHooks',
      results,
      errors,
      run: () =>
        this.workflowHookProjection.cleanupPluginWorkflowHooks(request),
    });
    await this.collectAdapterResult({
      action: 'cleanup',
      adapter: 'eventSubscriptions',
      results,
      errors,
      run: () =>
        this.eventSubscriptionProjection.cleanupPluginEventSubscriptions(
          request,
        ),
    });

    return { ok: errors.length === 0, action: 'cleanup', results, errors };
  }

  private async collectAdapterResult(params: {
    action: ProjectionAction;
    adapter: ProjectionAdapterName;
    results: PluginProjectionOrchestrationResult['results'];
    errors: PluginProjectionOrchestrationError[];
    run: () => Promise<AdapterProjectionResult[]>;
  }): Promise<void> {
    try {
      const adapterResults = await params.run();
      params.results[params.adapter] = adapterResults.map((result) =>
        this.toSafeProjectionResult(result),
      );
      if (adapterResults.some((result) => this.isFailureResult(result))) {
        params.errors.push(this.toSafeError(params.action, params.adapter));
      }
    } catch {
      params.errors.push(this.toSafeError(params.action, params.adapter));
    }
  }

  private emptyResults(): PluginProjectionOrchestrationResult['results'] {
    return {
      tools: [],
      workflowSteps: [],
      workflowHooks: [],
      eventSubscriptions: [],
    };
  }

  private isFailureResult(result: AdapterProjectionResult): boolean {
    return result.status === 'failed' || result.status === 'conflict';
  }

  private toSafeProjectionResult(
    result: AdapterProjectionResult,
  ): AdapterProjectionResult {
    if (!('errorMessage' in result)) return result;

    const safeResult = { ...result };
    delete safeResult.errorMessage;
    return safeResult;
  }

  private toSafeError(
    action: ProjectionAction,
    adapter: ProjectionAdapterName,
  ): PluginProjectionOrchestrationError {
    if (action === 'refresh') {
      return {
        adapter,
        code: 'plugin_projection_refresh_failed',
        message: 'Plugin projection refresh failed.',
      };
    }

    return {
      adapter,
      code: 'plugin_projection_cleanup_failed',
      message: 'Plugin projection cleanup failed.',
    };
  }
}
