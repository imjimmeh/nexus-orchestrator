import { Injectable, Logger } from "@nestjs/common";
import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { FailureClass, shouldCountFailure } from "@nexus/core";
import { OrchestrationService } from "./orchestration.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";
import { DispatchService } from "../dispatch/dispatch.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { resolveNonAutoWakeDecision } from "./orchestration-stop-decisions";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";

const DEFAULT_RECONCILE_INTERVAL_MS = 60000;

function readReconcileIntervalMs(): number {
  const value = Number(process.env.KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS);
  const rounded =
    Number.isFinite(value) && value > 0
      ? Math.round(value)
      : DEFAULT_RECONCILE_INTERVAL_MS;
  return rounded >= 1 ? rounded : DEFAULT_RECONCILE_INTERVAL_MS;
}

@Injectable()
export class OrchestrationContinuationReconcilerService
  implements OnModuleInit, OnModuleDestroy
{
  private reconcileIntervalId: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  private readonly logger = new Logger(
    OrchestrationContinuationReconcilerService.name,
  );

  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly wakeupService: ProjectOrchestrationWakeupService,
    private readonly dispatchService: DispatchService,
    private readonly leaseService: OrchestrationLeaseService,
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runReconcile();

    const intervalMs = readReconcileIntervalMs();
    this.reconcileIntervalId = setInterval(() => {
      void this.runReconcile();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.reconcileIntervalId) {
      clearInterval(this.reconcileIntervalId);
      this.reconcileIntervalId = null;
    }
  }

  async reconcileStaleContinuations(): Promise<{ evaluated: number }> {
    let evaluated = 0;
    const states =
      await this.orchestrationService.findOrchestratingStatesForContinuationCleanup();

    for (const state of states) {
      evaluated += 1;
      let clearedStopDecisionForOrphans = false;
      try {
        const reconcileResult =
          await this.dispatchService.reconcileProjectLinkedRuns(
            state.project_id,
          );

        if (reconcileResult.orphanReconciled.length > 0) {
          this.logger.log(
            `Detected ${reconcileResult.orphanReconciled.length} orphaned in-progress item(s) in project ${state.project_id}; ` +
              `clearing stop decision to enable recovery.`,
          );

          try {
            await this.orchestrationService.clearCycleDecision(
              state.project_id,
              {
                reason: `Automatic clear: ${reconcileResult.orphanReconciled.length} orphaned in-progress work item(s) detected with no linked workflow run.`,
              },
            );
            clearedStopDecisionForOrphans = true;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `clearCycleDecision failed for ${state.project_id}: ${message}`,
            );
          }
        }

        // Failure threshold retrospective trigger (work item 2b8d0c51 /
        // EPIC-117 / EPIC-202). The OrchestrationCycleDecisionService is
        // the only direct caller of the retrospective service's
        // `checkFailureThreshold`; we just record the pending consecutive
        // failure count on the orchestration metadata so the next cycle
        // decision can pick it up. This keeps the reconciler service free
        // of direct dependencies on the retrospective service.
        await this.maybeMarkPendingConsecutiveFailure(
          state.project_id,
          reconcileResult.reconciled,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `reconcileProjectLinkedRuns failed for ${state.project_id}: ${message}`,
        );
        continue;
      }

      await this.maybeHeartbeatCycleLease(
        state.project_id,
        (state as { linked_run_id?: string | null }).linked_run_id,
      );

      if (
        !clearedStopDecisionForOrphans &&
        this.isBlockedForAutomaticWakeup(state)
      ) {
        continue;
      }

      if (
        !clearedStopDecisionForOrphans &&
        (await this.shouldSuppressForProjectCapacity(state.project_id))
      ) {
        continue;
      }

      try {
        await this.wakeupService.requestWakeup({
          projectId: state.project_id,
          reason: "stale_reconciler",
          source: "orchestration_continuation_reconciler",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `requestWakeup failed for ${state.project_id}: ${message}`,
        );
      }
    }

    return { evaluated };
  }

  private isBlockedForAutomaticWakeup(state: {
    decision_log?: unknown;
    metadata?: unknown;
  }): boolean {
    return resolveNonAutoWakeDecision(state) !== undefined;
  }

  /**
   * Signals a pending consecutive-failure event on the orchestration
   * metadata so the OrchestrationCycleDecisionService can fire the
   * `failure_threshold` retrospective on the next cycle decision. This
   * keeps the reconciler service free of direct dependencies on the
   * retrospective service.
   *
   * Each failed run is classified via
   * {@link resolveReconciledRunFailureClass} (QA rejection vs system
   * failure) and the {@link shouldCountFailure} filter is applied so
   * only counting-class failures increment the pending counter. This
   * mirrors the synchronous producer in `OrchestrationContinuationService`
   * so the trigger sees consistent semantics on both paths.
   *
   * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
   * EPIC-117 / EPIC-202
   *
   * Failure classification: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  private async maybeMarkPendingConsecutiveFailure(
    projectId: string,
    reconciledRuns: ReadonlyArray<{
      status: string;
      workItemId?: string | null;
    }>,
  ): Promise<void> {
    const failedRuns = reconciledRuns.filter((r) => r.status === "FAILED");
    if (failedRuns.length === 0) {
      return;
    }
    let countingFailedRunCount = 0;
    for (const run of failedRuns) {
      const failureClass = await this.resolveReconciledRunFailureClass(
        projectId,
        run,
      );
      if (shouldCountFailure(failureClass)) {
        countingFailedRunCount += 1;
      }
    }
    if (countingFailedRunCount === 0) {
      return;
    }
    try {
      await this.orchestrationService.markPendingConsecutiveFailure(projectId, {
        failedRunCount: countingFailedRunCount,
        reason: `stale_reconciler: ${countingFailedRunCount} failed workflow run(s) detected (of ${failedRuns.length} total)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `markPendingConsecutiveFailure failed for ${projectId}: ${message}`,
      );
    }
  }

  /**
   * Resolves the {@link FailureClass} for a reconciled (failed) run.
   * Mirrors the consumer-side classification in
   * `core-lifecycle-stream.consumer.ts`: a work item with
   * `qa_decision: "reject"` on its metadata is a QA rejection
   * (intentional, not counted); everything else is a system failure
   * (counted).
   *
   * Best-effort: any metadata-read error is logged and the run is
   * conservatively classified as `SystemFailure` so it still counts.
   */
  private async resolveReconciledRunFailureClass(
    projectId: string,
    run: { workItemId?: string | null },
  ): Promise<FailureClass> {
    const workItemId = run.workItemId;
    if (typeof workItemId !== "string" || workItemId.length === 0) {
      return FailureClass.SystemFailure;
    }
    try {
      const item = await this.workItems.findByProjectAndId(
        projectId,
        workItemId,
      );
      const metadata = item?.metadata;
      if (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
      ) {
        const record: Record<string, unknown> = metadata;
        if (record.qa_decision === "reject") {
          return FailureClass.QaRejection;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read work item ${workItemId} metadata for failure classification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return FailureClass.SystemFailure;
  }

  private async maybeHeartbeatCycleLease(
    projectId: string,
    linkedRunId: string | null | undefined,
  ): Promise<void> {
    if (!linkedRunId) {
      return;
    }
    try {
      await this.leaseService.heartbeatCycleLease(projectId);
    } catch (error) {
      this.logger.warn(
        `heartbeatCycleLease failed for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async shouldSuppressForProjectCapacity(
    projectId: string,
  ): Promise<boolean> {
    try {
      const capacity =
        await this.dispatchService.resolveProjectDispatchCapacity(projectId);
      if (capacity.canLaunchNewWork) {
        return false;
      }
      this.logger.debug(
        `stale_reconciler_project_wip_limit_reached for ${projectId}: activeCount=${capacity.activeCount}, maxActive=${capacity.maxActive}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `resolveProjectDispatchCapacity failed for ${projectId}: ${message}`,
      );
      return false;
    }
  }

  private async runReconcile(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;

    try {
      await this.reconcileStaleContinuations();
    } catch (error) {
      this.logger.warn(
        `reconcileStaleContinuations failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlight = false;
    }
  }
}
