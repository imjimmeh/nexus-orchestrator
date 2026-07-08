import type { Logger } from "@nestjs/common";
import type { FailureClass } from "@nexus/core";
import type { IKanbanRetrospectiveFailureThresholdService } from "../retrospectives/kanban-retrospective-failure-threshold.types";

/**
 * Helpers used by {@link OrchestrationCycleDecisionService} to wire
 * the consecutive-failure threshold trigger and the success-side
 * counter reset through the orchestrator's dependency bundle.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep
 * that service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 * Failure classification: 2a64258d-8542-4ca0-b582-42a69dd61ff0
 * (WI-2026-062).
 */
export async function runFailureThresholdTrigger(args: {
  readonly projectId: string;
  readonly failureClass?: FailureClass;
  readonly failureThresholdService: IKanbanRetrospectiveFailureThresholdService;
  readonly logger: Logger;
}): Promise<void> {
  try {
    if (args.failureClass === undefined) {
      await args.failureThresholdService.checkFailureThreshold(args.projectId);
    } else {
      await args.failureThresholdService.checkFailureThreshold(
        args.projectId,
        args.failureClass,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    args.logger.error(
      `Failure-threshold trigger failed for project ${args.projectId}: ${message}`,
    );
  }
}

export async function runFailureCounterReset(args: {
  readonly projectId: string;
  readonly failureThresholdService: IKanbanRetrospectiveFailureThresholdService;
  readonly logger: Logger;
}): Promise<void> {
  try {
    await args.failureThresholdService.resetConsecutiveFailureCount(
      args.projectId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    args.logger.warn(
      `Failed to reset consecutive failure count for project ${args.projectId}: ${message}`,
    );
  }
}

/**
 * Drains the `pending_consecutive_failure_count` flag persisted on
 * the orchestration metadata (by orchestrator-side paths such as the
 * stale reconciler) into the retrospective service's counter. One
 * `checkFailureThreshold` call increments the counter by exactly one,
 * so the pending count is replayed as that many successive calls. The
 * pending flag is cleared after the drain so the same failures are not
 * counted twice.
 */
export async function drainPendingConsecutiveFailure(args: {
  readonly projectId: string;
  readonly metadata: Record<string, unknown>;
  readonly failureClass: FailureClass;
  readonly failureThresholdService: IKanbanRetrospectiveFailureThresholdService;
  readonly clearPendingConsecutiveFailure: (projectId: string) => Promise<void>;
  readonly logger: Logger;
}): Promise<void> {
  const pendingCount =
    typeof args.metadata.pending_consecutive_failure_count === "number"
      ? args.metadata.pending_consecutive_failure_count
      : 0;
  if (pendingCount <= 0) {
    return;
  }

  for (let i = 0; i < pendingCount; i += 1) {
    await runFailureThresholdTrigger({
      projectId: args.projectId,
      failureClass: args.failureClass,
      failureThresholdService: args.failureThresholdService,
      logger: args.logger,
    });
  }

  try {
    await args.clearPendingConsecutiveFailure(args.projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    args.logger.warn(
      `Failed to clear pending_consecutive_failure_count for project ${args.projectId}: ${message}`,
    );
  }
}
