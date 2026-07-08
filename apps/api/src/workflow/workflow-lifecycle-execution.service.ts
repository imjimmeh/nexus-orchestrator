import { Inject, Injectable } from '@nestjs/common';
import {
  isTerminalWorkflowRunStatus,
  WorkflowStatus,
  type WorkflowLifecycleExecutionRequest,
  type WorkflowLifecycleExecutionResult,
  type WorkflowLifecycleResultStatus,
  type WorkflowLifecycleWorkflowResult,
} from '@nexus/core';
import { sleep } from '../common/utils/async.utils';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { WorkflowLifecycleResultRepository } from './database/repositories/workflow-lifecycle-result.repository';
import { WorkflowEngineService } from './workflow-engine.service';
import { evaluateTriggerCondition } from './workflow-trigger-condition.helpers';
import type { WorkflowTriggerBinding } from './workflow-trigger-registry.service';
import { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';

export const DEFAULT_LIFECYCLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_LIFECYCLE_POLL_INTERVAL_MS = 1000;

const MIN_LIFECYCLE_POLL_INTERVAL_MS = 50;

interface LifecyclePollingResult {
  status: WorkflowLifecycleResultStatus;
  error?: string;
}

@Injectable()
export class WorkflowLifecycleExecutionService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository: IWorkflowDefinitionRepository,
    private readonly triggerRegistry: WorkflowTriggerRegistryService,
    private readonly workflowEngine: WorkflowEngineService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly workflowLifecycleResultRepository: WorkflowLifecycleResultRepository,
  ) {}

  async executeLifecycleWorkflows(
    request: WorkflowLifecycleExecutionRequest,
  ): Promise<WorkflowLifecycleExecutionResult> {
    const blockingOnly = request.blockingOnly === true;
    const workflows = await this.workflowRepository.findActiveBySourceScope(
      'repository',
      request.scopeId,
    );
    const bindings = this.resolveBindingsWithAliases(workflows, {
      phase: request.phase,
      hook: request.hook,
      blockingOnly,
    });

    const results: WorkflowLifecycleWorkflowResult[] = [];

    for (const binding of bindings) {
      results.push(await this.executeBinding(binding, request));
    }

    const aggregateStatus = this.aggregateStatus(results);

    const saved = await this.workflowLifecycleResultRepository.save({
      scope_id: request.scopeId,
      context_id: request.contextId ?? null,
      phase: request.phase,
      hook: request.hook,
      blocking_only: blockingOnly,
      aggregate_status: aggregateStatus,
      results,
      repository_ref: request.repositoryRef ?? null,
    });

    return {
      id: saved.id,
      scopeId: request.scopeId,
      ...(request.contextId ? { contextId: request.contextId } : {}),
      phase: request.phase,
      hook: request.hook,
      blockingOnly,
      status: aggregateStatus,
      results,
    };
  }

  private async executeBinding(
    binding: WorkflowTriggerBinding,
    request: WorkflowLifecycleExecutionRequest,
  ): Promise<WorkflowLifecycleWorkflowResult> {
    const triggerData = this.buildTriggerData(binding, request);
    const baseResult = this.buildBaseResult(binding, request);

    if (!evaluateTriggerCondition(binding.condition, triggerData)) {
      return { ...baseResult, status: 'skipped' };
    }

    let runId: string | null;
    try {
      runId = await this.workflowEngine.startWorkflow(
        binding.workflowId,
        triggerData,
      );
    } catch (error) {
      return {
        ...baseResult,
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (!runId) {
      return { ...baseResult, status: 'skipped' };
    }

    const pollResult = await this.waitForRunStatus(runId, request);

    return { ...baseResult, ...pollResult, runId };
  }

  private buildTriggerData(
    binding: WorkflowTriggerBinding,
    request: WorkflowLifecycleExecutionRequest,
  ): Record<string, unknown> {
    const payload = { ...(request.payload ?? {}) };
    delete payload.scopeId;
    delete payload.contextId;
    delete payload.phase;
    delete payload.hook;
    delete payload.lifecycle;

    return {
      ...payload,
      scopeId: request.scopeId,
      ...(request.contextId ? { contextId: request.contextId } : {}),
      phase: request.phase,
      hook: request.hook,
      lifecycle: {
        phase: request.phase,
        hook: request.hook,
        blocking: binding.blocking === true,
      },
    };
  }

  private buildBaseResult(
    binding: WorkflowTriggerBinding,
    request: WorkflowLifecycleExecutionRequest,
  ): Omit<WorkflowLifecycleWorkflowResult, 'status'> {
    return {
      workflowId: binding.workflowId,
      workflowDefinitionId: binding.workflowDefinitionId,
      workflowName: binding.workflowName,
      phase: request.phase,
      hook: request.hook,
      blocking: binding.blocking === true,
    };
  }

  private async waitForRunStatus(
    runId: string,
    request: WorkflowLifecycleExecutionRequest,
  ): Promise<LifecyclePollingResult> {
    const { timeoutMs, pollIntervalMs } = this.resolvePollingOptions(request);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      let run: Awaited<ReturnType<IWorkflowRunRepository['findById']>>;
      try {
        run = await this.workflowRunRepository.findById(runId);
      } catch (error) {
        return {
          status: 'unavailable',
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (!run) {
        return { status: 'unavailable' };
      }

      if (isTerminalWorkflowRunStatus(run.status)) {
        return { status: this.mapTerminalStatus(run.status) };
      }

      const remainingTimeoutMs = deadline - Date.now();
      if (remainingTimeoutMs <= 0) {
        break;
      }

      await sleep(Math.min(pollIntervalMs, remainingTimeoutMs));
    }

    return { status: 'timed_out' };
  }

  private resolvePollingOptions(request: WorkflowLifecycleExecutionRequest): {
    timeoutMs: number;
    pollIntervalMs: number;
  } {
    return {
      timeoutMs: this.resolvePositiveMilliseconds(
        request.timeoutMs,
        DEFAULT_LIFECYCLE_TIMEOUT_MS,
      ),
      pollIntervalMs: Math.max(
        this.resolvePositiveMilliseconds(
          request.pollIntervalMs,
          DEFAULT_LIFECYCLE_POLL_INTERVAL_MS,
        ),
        MIN_LIFECYCLE_POLL_INTERVAL_MS,
      ),
    };
  }

  private resolvePositiveMilliseconds(
    value: number | undefined,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return value;
  }

  private mapTerminalStatus(
    status: WorkflowStatus,
  ): WorkflowLifecycleResultStatus {
    if (status === WorkflowStatus.COMPLETED) {
      return 'passed';
    }

    return 'failed';
  }

  private aggregateStatus(
    results: WorkflowLifecycleWorkflowResult[],
  ): WorkflowLifecycleResultStatus {
    if (
      results.length === 0 ||
      results.every((result) => result.status === 'skipped')
    ) {
      return 'skipped';
    }

    for (const status of [
      'timed_out',
      'unavailable',
      'failed',
      'passed',
    ] as const) {
      if (results.some((result) => result.status === status)) {
        return status;
      }
    }

    return 'skipped';
  }

  private getLegacyPhaseAliases(phase: string): string[] {
    const ALIASES: Readonly<Record<string, string[]>> = {
      'ready-to-merge': ['merge'],
    };
    return ALIASES[phase] ?? [];
  }

  private resolveBindingsWithAliases(
    workflows: Parameters<
      WorkflowTriggerRegistryService['resolveLifecycleBindings']
    >[0],
    options: { phase: string; hook: string; blockingOnly: boolean },
  ): WorkflowTriggerBinding[] {
    const primary = this.triggerRegistry.resolveLifecycleBindings(
      workflows,
      options,
    );
    const seen = new Set(primary.map((b) => b.workflowId));
    const aliases = this.getLegacyPhaseAliases(options.phase);
    const fromAliases = aliases.flatMap((alias) =>
      this.triggerRegistry
        .resolveLifecycleBindings(workflows, { ...options, phase: alias })
        .filter((b) => !seen.has(b.workflowId)),
    );
    return [...primary, ...fromAliases];
  }
}
