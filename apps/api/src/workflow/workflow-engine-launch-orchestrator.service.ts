import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IJob,
  IWorkflowDefinition,
  IWorkflowRun,
  WorkflowStatus,
} from '@nexus/core';
import { DAGResolverService } from './dag-resolver.service';
import { buildWorkflowDryRunResult } from './workflow-dry-run.utils';
import {
  StartWorkflowOptions,
  WorkflowDryRunResult,
} from './workflow-engine.types';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_STARTED_EVENT,
} from './workflow-events.constants';
import type { WorkflowRunEvent } from './workflow-events.types';
import { WorkflowConcurrencyManager } from './workflow-concurrency-manager.service';
import { WorkflowLaunchDedupeService } from './workflow-launch-dedupe.service';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import {
  type IWorkflowCancellationCascadeService,
  WORKFLOW_CANCELLATION_CASCADE_SERVICE,
} from './kernel/interfaces/workflow-kernel.ports';
import { buildInitialStateVariables } from './workflow-initial-state.util';
import { VariableResolverService } from '../variables/variable-resolver.service';

/**
 * Owns the launch + concurrency + dry-run path that
 * `WorkflowEngineService.startWorkflow` used to run inline. The
 * orchestrator handles:
 *
 * - launch-dedupe shortcut (`workflow-launch-dedupe` ↦ `concurrency.runExclusive`
 *   ↦ reuse-existing-or-create);
 * - concurrency-policy branching (`proceed` / `skip` / `queue` / `cancel`);
 * - legacy trigger-context dedupe (concurrency-less workflows);
 * - run creation, `WORKFLOW_RUN_STARTED_EVENT` emission, initial-DAG
 *   scheduling, and `WORKFLOW_RUN_COMPLETED_EVENT` emission for workflows
 *   that have no first-step jobs;
 * - dry-run simulation that derives an execution preview from the loaded
 *   definition without persisting any state.
 *
 * Public surface:
 *
 * - `startAndDedupRun(workflowId, triggerData, def)` for the runtime path;
 * - `simulateDryRun(workflowId, triggerData, def, options)` for the dry-run
 *   path that `WorkflowEngineService.startWorkflow` still owns as a public
 *   entry point.
 *
 * The engine still owns `prepareTriggerData` (it lives on the same
 * `WorkflowLaunchDedupeService` so the engineer can pre-compute the
 * `triggerData` shape with the dedupe key installed before handing off to
 * the orchestrator) and the dry-run short-circuit delegation.
 */
@Injectable()
export class WorkflowEngineLaunchOrchestratorService {
  private readonly logger = new Logger(
    WorkflowEngineLaunchOrchestratorService.name,
  );

  constructor(
    private readonly persistence: WorkflowPersistenceService,
    private readonly concurrency: WorkflowConcurrencyManager,
    private readonly dagResolver: DAGResolverService,
    private readonly runExecution: WorkflowRunJobExecutionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowLaunchDedupe: WorkflowLaunchDedupeService,
    @Inject(WORKFLOW_CANCELLATION_CASCADE_SERVICE)
    private readonly cancellationCascade: IWorkflowCancellationCascadeService,
    private readonly variableResolver: VariableResolverService,
  ) {}

  /**
   * Public entry point for the runtime launch path. The engine hands the
   * orchestrator the already-prepared trigger data (with `dedupeKey`
   * resolved and installed by `WorkflowLaunchDedupeService.prepareTriggerData`)
   * plus the loaded executable definition, then awaits either:
   *
   * - a fresh run id (concurrency `proceed` or `cancel` branch);
   * - an existing run id reused from launch-dedupe or trigger-context dedupe;
   * - a freshly queued run id (concurrency `queue` branch);
   * - `null` (concurrency `skip` branch — the launch was suppressed, no run
   *   was created).
   */
  async startAndDedupRun(
    persistedWorkflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
  ): Promise<string | null> {
    const launchDedupeKey =
      this.workflowLaunchDedupe.resolveLaunchDedupeKey(triggerData);

    if (launchDedupeKey) {
      return this.concurrency.runExclusive(
        this.workflowLaunchDedupe.lockKey(persistedWorkflowId, launchDedupeKey),
        async () => {
          const existing = await this.workflowLaunchDedupe.findExistingRun(
            persistedWorkflowId,
            launchDedupeKey,
          );
          if (existing) {
            this.logger.log(
              `Skipping duplicate workflow launch ${persistedWorkflowId} for dedupe key ${launchDedupeKey}; existing run ${existing.id}`,
            );
            return existing.id;
          }

          return this.startWorkflowAfterLaunchDedupe(
            persistedWorkflowId,
            triggerData,
            def,
          );
        },
      );
    }

    return this.startWorkflowAfterLaunchDedupe(
      persistedWorkflowId,
      triggerData,
      def,
    );
  }

  /**
   * Dry-run delegation. The engine remains the public entry point for dry-run
   * so external callers (e.g. `WorkflowLaunchOrchestrationService`) continue
   * to call `WorkflowEngineService.startWorkflow` with `{ dryRun: true }`,
   * but the analysis itself uses this orchestrator's `dagResolver`.
   */
  async simulateDryRun(
    workflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
    options: StartWorkflowOptions,
  ): Promise<WorkflowDryRunResult> {
    return buildWorkflowDryRunResult({
      workflowId,
      triggerData,
      definition: def,
      mockJobOutputs: options.mockJobOutputs ?? {},
      mockJobOutputResolvers: options.mockJobOutputResolvers,
      dagResolver: this.dagResolver,
    });
  }

  private async startWorkflowAfterLaunchDedupe(
    persistedWorkflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
  ): Promise<string | null> {
    // Concurrency policy check (runs before dedup for broader scope control)
    if (def.concurrency) {
      const lockKey = `concurrency:${persistedWorkflowId}`;
      return this.concurrency.runExclusive(lockKey, async () => {
        return this.startWorkflowWithConcurrency(
          persistedWorkflowId,
          triggerData,
          def,
        );
      });
    }

    // Legacy dedup path for workflows without concurrency config
    const dedupeKey = this.concurrency.resolveDedupeKey(
      persistedWorkflowId,
      triggerData,
    );
    if (dedupeKey) {
      return this.concurrency.runExclusive(dedupeKey, async () => {
        const existing = await this.concurrency.findActiveRun(
          persistedWorkflowId,
          triggerData,
        );
        if (existing) {
          this.logger.log(
            `Reusing active run ${existing.id} for ${persistedWorkflowId}`,
          );
          return existing.id;
        }

        return this.createAndStartRun(persistedWorkflowId, triggerData, def);
      });
    }

    return this.createAndStartRun(persistedWorkflowId, triggerData, def);
  }

  private async startWorkflowWithConcurrency(
    workflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
  ): Promise<string | null> {
    const result = await this.concurrency.checkConcurrency(
      workflowId,
      triggerData,
      def,
    );

    switch (result.action) {
      case 'proceed':
        return this.createAndStartRun(
          workflowId,
          triggerData,
          def,
          result.concurrencyScope,
        );

      case 'skip':
        this.logger.log(
          `Skipping workflow ${workflowId} due to concurrency policy`,
        );
        return null;

      case 'queue':
        return this.concurrency.createQueuedRun(
          workflowId,
          triggerData,
          result.concurrencyScope,
        );

      case 'cancel': {
        await this.cancellationCascade.cancelRun(
          result.cancelRunId,
          'concurrency_cancel_running',
        );
        return this.createAndStartRun(
          workflowId,
          triggerData,
          def,
          result.concurrencyScope,
        );
      }
    }
  }

  private async createAndStartRun(
    workflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
    concurrencyScope?: string,
  ): Promise<string> {
    const launchDedupeKey =
      this.workflowLaunchDedupe.resolveLaunchDedupeKey(triggerData);
    const initialState = await buildInitialStateVariables(
      triggerData,
      this.variableResolver,
    );
    let run: IWorkflowRun;
    try {
      run = await this.persistence.createRun({
        workflow_id: workflowId,
        status: WorkflowStatus.RUNNING,
        state_variables: initialState,
        ...(concurrencyScope ? { concurrency_scope: concurrencyScope } : {}),
        ...(launchDedupeKey ? { launch_dedupe_key: launchDedupeKey } : {}),
      });
    } catch (error) {
      return this.workflowLaunchDedupe.recoverExistingRunIdAfterDuplicate(
        workflowId,
        launchDedupeKey,
        error,
      );
    }

    const startedEvent: WorkflowRunEvent = {
      workflowRunId: run.id,
      workflowId,
      status: WorkflowStatus.RUNNING,
      stateVariables: run.state_variables,
      triggerData,
    };
    this.eventEmitter.emit(WORKFLOW_RUN_STARTED_EVENT, startedEvent);

    const jobs = def.jobs ?? [];
    const graph = this.dagResolver.buildDependencyGraph(jobs);
    const parallelGroups = this.dagResolver.findParallelJobs(graph);

    const firstJobs = this.resolveInitialDagJobs(jobs, parallelGroups[0] ?? []);

    if (firstJobs.length > 0) {
      await this.persistence.updateRun(run.id, {
        current_step_id: firstJobs[0],
      });

      for (const jobId of firstJobs) {
        await this.runExecution.enqueueJob(run.id, def, jobId);
      }
    } else {
      run.status = WorkflowStatus.COMPLETED;
      await this.persistence.updateRunStatus(run.id, run.status);
      const completedEvent: WorkflowRunEvent = {
        workflowRunId: run.id,
        workflowId,
        status: WorkflowStatus.COMPLETED,
        stateVariables: run.state_variables,
      };
      this.eventEmitter.emit(WORKFLOW_RUN_COMPLETED_EVENT, completedEvent);
    }

    return run.id;
  }

  private resolveInitialDagJobs(
    jobs: IJob[],
    firstParallelGroup: string[],
  ): string[] {
    const transitionTargets = new Set<string>();
    for (const job of jobs) {
      for (const transition of job.transitions ?? []) {
        transitionTargets.add(transition.next);
      }
    }

    return firstParallelGroup.filter((jobId) => !transitionTargets.has(jobId));
  }
}
