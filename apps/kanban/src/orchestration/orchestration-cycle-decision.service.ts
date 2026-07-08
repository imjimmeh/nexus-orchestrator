import { Inject, Injectable, Logger } from "@nestjs/common";
import { FailureClass } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanRetrospectiveService } from "../retrospectives/kanban-retrospective.service";
import {
  KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
  type IKanbanRetrospectiveFailureThresholdService,
} from "../retrospectives/kanban-retrospective-failure-threshold.types";
import {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  type ClearPendingConsecutiveFailure,
} from "./orchestration-cycle-decision.service.types";
import {
  parseCycleDecision,
} from "./orchestration-decision-log.utils";
import type {
  DecisionEntry,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";
import {
  drainPendingConsecutiveFailure,
  runFailureCounterReset,
  runFailureThresholdTrigger,
} from "./orchestration-cycle-decision-failure.helpers";
import {
  resolveDuplicateCycleReplay,
  shouldSkipAutonomousDefault,
} from "./orchestration-cycle-decision-replay.helpers";
import {
  applyDecisionMetadata,
  buildCycleDecisionEntry,
} from "./orchestration-cycle-decision-entry.helpers";
import { resolveSafeCycleDecision } from "./orchestration-cycle-decision-safety.helpers";
import { runCompletionRetrospective } from "./orchestration-cycle-decision-retrospective.helpers";

/**
 * Injection token for the orchestrator-supplied callback that clears
 * the pending consecutive-failure flag on a project's metadata after
 * the cycle decision service has drained it into the failure-threshold
 * service. The orchestrator is the only owner of the
 * `requirePersistenceState` / `savePersistenceState` plumbing that the
 * clear path needs, so the callback is wired in from the orchestrator
 * side via a factory provider in `OrchestrationModule`.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
 * EPIC-117 / EPIC-202
 */
export {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  type ClearPendingConsecutiveFailure,
} from "./orchestration-cycle-decision.service.types";

type CycleDecisionInput =
  import("./orchestration-cycle-decision.service.types").OrchestrationCycleDecisionInput;

type CycleDecisionResult =
  import("./orchestration-cycle-decision.service.types").OrchestrationCycleDecisionResult;

export type {
  OrchestrationCycleDecisionInput,
  OrchestrationCycleDecisionResult,
} from "./orchestration-cycle-decision.service.types";

type RecordCycleDecisionArgs = {
  projectId: string;
  existing: OrchestrationPersistenceRecord;
  metadata: Record<string, unknown>;
  input: CycleDecisionInput;
  getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[];
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
};

type ClearCycleDecisionArgs = {
  existing: OrchestrationPersistenceRecord;
  metadata: Record<string, unknown>;
  reason: string;
  getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[];
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
};

@Injectable()
export class OrchestrationCycleDecisionService {
  private readonly logger = new Logger(OrchestrationCycleDecisionService.name);

  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly retrospectives: KanbanRetrospectiveService,
    @Inject(KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE)
    private readonly failureThresholdService: IKanbanRetrospectiveFailureThresholdService,
    @Inject(ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE)
    private readonly clearPendingConsecutiveFailureFn: ClearPendingConsecutiveFailure,
  ) {}

  async recordCycleDecision(
    args: RecordCycleDecisionArgs,
  ): Promise<CycleDecisionResult> {
    // Failure-threshold trigger (work item 2b8d0c51 / EPIC-117 / EPIC-202).
    // Drain any pending consecutive failure count persisted by the
    // orchestrator-side paths (e.g. the stale reconciler) into the
    // retrospective service's counter before the rest of the cycle
    // decision runs. This keeps the cycle decision service as the only
    // direct caller of `checkFailureThreshold`.
    await drainPendingConsecutiveFailure({
      projectId: args.projectId,
      metadata: args.metadata,
      failureClass: args.input.failureClass ?? FailureClass.SystemFailure,
      failureThresholdService: this.failureThresholdService,
      clearPendingConsecutiveFailure: this.clearPendingConsecutiveFailureFn,
      logger: this.logger,
    });

    const duplicate = resolveDuplicateCycleReplay({
      metadata: args.metadata,
      input: args.input,
      existing: args.existing,
      getDecisionLog: args.getDecisionLog,
    });
    if (duplicate) {
      return duplicate;
    }

    if (
      shouldSkipAutonomousDefault({
        input: args.input,
        existing: args.existing,
        metadata: args.metadata,
        getDecisionLog: args.getDecisionLog,
      })
    ) {
      return {
        decision: "repeat",
        reason: args.input.reason,
        persisted: false,
        duplicate: false,
        skipped: true,
      };
    }

    const requestedDecision = args.input.decision ?? "repeat";
    const safeDecision = await resolveSafeCycleDecision({
      projectId: args.projectId,
      existing: args.existing,
      requestedDecision,
      reason: args.input.reason,
      workItems: this.workItems,
    });

    const recordedAt = new Date().toISOString();
    const wasAutonomousDefault = args.input.decision === undefined;
    const nextDecisionEntry = buildCycleDecisionEntry({
      decision: safeDecision.decision,
      reason: safeDecision.reason,
      recordedAt,
      input: args.input,
      wasAutonomousDefault,
    });

    applyDecisionMetadata({
      metadata: args.metadata,
      safeDecision,
      recordedAt,
      input: args.input,
      wasAutonomousDefault,
    });

    await args.savePersistenceState(args.existing, {
      decision_log: [...args.getDecisionLog(args.existing), nextDecisionEntry],
      metadata: args.metadata,
    });

    if (safeDecision.decision === "complete") {
      await runCompletionRetrospective({
        projectId: args.projectId,
        existing: args.existing,
        input: {
          triggerRevisionMarker: args.input.idempotencyKey ?? recordedAt,
          decisionIdempotencyKey: args.input.idempotencyKey,
        },
        retrospectives: this.retrospectives,
        logger: this.logger,
      });
    }

    // Failure-threshold retrospective trigger (work item 2b8d0c51 /
    // EPIC-117 / EPIC-202). When the caller signals that the previous
    // workflow run ended in FAILED status, fire the threshold check
    // synchronously so the retrospective lands BEFORE the next
    // orchestration cycle completes. When the cycle decision is `complete`
    // (the project successfully finished an orchestration cycle), reset
    // the consecutive failure counter so the next failure starts fresh.
    if (args.input.consecutiveFailure === true) {
      await runFailureThresholdTrigger({
        projectId: args.projectId,
        ...(args.input.failureClass === undefined
          ? {}
          : { failureClass: args.input.failureClass }),
        failureThresholdService: this.failureThresholdService,
        logger: this.logger,
      });
    } else if (safeDecision.decision === "complete") {
      await runFailureCounterReset({
        projectId: args.projectId,
        failureThresholdService: this.failureThresholdService,
        logger: this.logger,
      });
    }

    return {
      decision: safeDecision.decision,
      reason: safeDecision.reason,
      persisted: true,
      duplicate: false,
      ...(args.input.consecutiveFailure === true
        ? { failureClass: args.input.failureClass }
        : {}),
    };
  }

  async clearCycleDecision(args: ClearCycleDecisionArgs): Promise<void> {
    const previousDecision = parseCycleDecision(args.metadata.cycle_decision);

    delete args.metadata.cycle_decision;
    delete args.metadata.cycle_decision_reason;
    delete args.metadata.cycle_decision_recorded_at;
    delete args.metadata.cycle_decision_idempotency_key;
    delete args.metadata.cycle_decision_autonomous_default;

    await args.savePersistenceState(args.existing, {
      decision_log: [
        ...args.getDecisionLog(args.existing),
        {
          timestamp: new Date().toISOString(),
          type: "cycle_decision_cleared",
          reasoning: args.reason,
          actions: ["clear_cycle_decision"],
          reason: args.reason,
          previousDecision,
        },
      ],
      metadata: args.metadata,
    });
  }
}