/**
 * Event Handler for Cycle Decision Events.
 *
 * This module provides the event handler that receives
 * kanban.retrospective_cycle_decision_recorded events and stores them
 * for inclusion in retrospective reports.
 *
 * @module retrospectives/events/cycle-decision-event.handler
 */

import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { getKanbanEventEmitter } from "../../events/kanban-event-emitter";
import { KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE } from "../../events/types/retrospective-cycle-decision.types";
import type {
  StoredCycleDecisionEvidence,
  CycleDecisionEventHandlerOptions,
  KanbanRetrospectiveCycleDecisionRecordedEvent,
} from "./cycle-decision-event.types";

/**
 * Default handler options.
 */
const DEFAULT_MAX_STORED_DECISIONS = 100;
const DEFAULT_WINDOW_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Event handler for kanban.retrospective_cycle_decision_recorded events.
 *
 * This handler:
 * 1. Receives cycle decision events from the event emitter
 * 2. Stores them for aggregation in retrospective reports
 * 3. Provides methods to retrieve decisions by project within a window
 *
 * @example
 * ```typescript
 * const handler = new CycleDecisionEventHandler();
 * handler.register();
 *
 * // Later, when generating a retrospective:
 * const decisions = handler.getDecisionsForProject("proj-123");
 * ```
 */
@Injectable()
export class CycleDecisionEventHandler implements OnModuleDestroy {
  private readonly logger = new Logger(CycleDecisionEventHandler.name);
  private readonly storage: Map<string, StoredCycleDecisionEvidence[]> =
    new Map();
  private readonly options: Required<CycleDecisionEventHandlerOptions>;
  private isRegistered = false;

  constructor(@Optional() options: CycleDecisionEventHandlerOptions = {}) {
    this.options = {
      maxStoredDecisionsPerProject:
        options.maxStoredDecisionsPerProject ?? DEFAULT_MAX_STORED_DECISIONS,
      windowDurationMs: options.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS,
    };
  }

  /**
   * Registers the event listener with the kanban event emitter.
   * Call this during module initialization.
   */
  register(): void {
    if (this.isRegistered) {
      this.logger.warn("Event handler already registered");
      return;
    }

    const emitter = getKanbanEventEmitter();
    emitter.on(
      KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
      this.handleCycleDecisionEvent.bind(this),
    );
    this.isRegistered = true;
    this.logger.log(
      `Registered handler for ${KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE}`,
    );
  }

  /**
   * Handles incoming cycle decision events.
   * Stores the event data for retrospective evidence aggregation.
   */
  private handleCycleDecisionEvent(
    event: KanbanRetrospectiveCycleDecisionRecordedEvent,
  ): void {
    try {
      this.logger.debug(
        `Received cycle decision event: ${event.decision} for project ${event.project_id}`,
      );

      const evidence = this.transformToEvidence(event);
      this.storeEvidence(evidence);

      this.logger.log(
        `Stored cycle decision evidence: ${evidence.decisionType} for project ${evidence.projectId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle cycle decision event: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Transforms the event to stored evidence format.
   */
  private transformToEvidence(
    event: KanbanRetrospectiveCycleDecisionRecordedEvent,
  ): StoredCycleDecisionEvidence {
    const now = new Date();
    const windowEnd = now.toISOString();
    const windowStart = new Date(
      now.getTime() - this.options.windowDurationMs,
    ).toISOString();

    return {
      evidenceId: `evidence-${event.idempotency_key ?? event.timestamp}`,
      projectId: event.project_id,
      decisionType: event.decision,
      reason: event.reason,
      boardState: {
        totalItems: event.board_state_snapshot.total_items,
        countsByStatus: event.board_state_snapshot.items_by_status,
        blockedItems: event.board_state_snapshot.blocked_items,
        completionRate: event.board_state_snapshot.completion_rate,
        goalCoverage: {
          totalGoals: event.board_state_snapshot.goal_coverage.total_goals,
          coveredGoals: event.board_state_snapshot.goal_coverage.covered_goals,
          goalIds: event.board_state_snapshot.goal_coverage.goal_ids,
        },
      },
      isSubstantive: this.isSubstantiveDecision(
        event.decision,
        event.board_state_snapshot.blocked_items,
      ),
      idempotencyKey: event.idempotency_key,
      provenance: {
        workflowRunId: event.cycle_metadata.workflow_run_id,
        jobId: event.cycle_metadata.job_id,
        decisionSource: event.cycle_metadata.decision_source,
      },
      recordedAt: event.timestamp,
      storedAt: now.toISOString(),
      windowStart,
      windowEnd,
    };
  }

  /**
   * Determines if a decision is considered substantive.
   * A decision is substantive if:
   * - It's 'blocked', 'complete', or 'abandon'
   * - It's 'repeat' with a board mutation
   */
  private isSubstantiveDecision(
    decision: string,
    blockedItems: number,
  ): boolean {
    const substantiveTypes = ["blocked", "complete", "abandon"];
    if (substantiveTypes.includes(decision)) {
      return true;
    }

    // 'repeat' is only substantive if there were blocked items
    // (indicating a board mutation was needed)
    return decision === "repeat" && blockedItems > 0;
  }

  /**
   * Stores the evidence, maintaining per-project storage with limits.
   */
  private storeEvidence(evidence: StoredCycleDecisionEvidence): void {
    const projectDecisions = this.storage.get(evidence.projectId) ?? [];

    // Add new evidence
    projectDecisions.unshift(evidence);

    // Trim to max size
    if (projectDecisions.length > this.options.maxStoredDecisionsPerProject) {
      projectDecisions.length = this.options.maxStoredDecisionsPerProject;
    }

    this.storage.set(evidence.projectId, projectDecisions);
  }

  /**
   * Gets all cycle decision evidence for a project within the default window.
   *
   * @param projectId - The project to get decisions for
   * @returns Array of cycle decision evidence, sorted by most recent first
   */
  getDecisionsForProject(projectId: string): StoredCycleDecisionEvidence[] {
    return this.storage.get(projectId) ?? [];
  }

  /**
   * Gets all cycle decision evidence for a project within a specific window.
   *
   * @param projectId - The project to get decisions for
   * @param windowStart - Start of the retrospective window (ISO string)
   * @param windowEnd - End of the retrospective window (ISO string)
   * @returns Array of cycle decision evidence within the window
   */
  getDecisionsInWindow(
    projectId: string,
    windowStart: string,
    windowEnd: string,
  ): StoredCycleDecisionEvidence[] {
    const decisions = this.storage.get(projectId) ?? [];
    const startTime = new Date(windowStart).getTime();
    const endTime = new Date(windowEnd).getTime();

    return decisions.filter((decision) => {
      const recordedTime = new Date(decision.recordedAt).getTime();
      return recordedTime >= startTime && recordedTime <= endTime;
    });
  }

  /**
   * Gets aggregated statistics for cycle decisions of a project.
   *
   * @param projectId - The project to get statistics for
   * @returns Aggregated statistics for the project's decisions
   */
  getDecisionsStats(projectId: string): {
    total: number;
    substantive: number;
    trivial: number;
    distributionByType: Record<string, number>;
    latestTimestamp: string | null;
  } {
    const decisions = this.storage.get(projectId) ?? [];

    const distributionByType: Record<string, number> = {};
    let substantive = 0;
    let trivial = 0;

    for (const decision of decisions) {
      distributionByType[decision.decisionType] =
        (distributionByType[decision.decisionType] ?? 0) + 1;

      if (decision.isSubstantive) {
        substantive++;
      } else {
        trivial++;
      }
    }

    const latestTimestamp =
      decisions.length > 0 ? decisions[0].recordedAt : null;

    return {
      total: decisions.length,
      substantive,
      trivial,
      distributionByType,
      latestTimestamp,
    };
  }

  /**
   * Clears all stored evidence for a project.
   * Useful for testing or data reset scenarios.
   */
  clearProjectDecisions(projectId: string): void {
    this.storage.delete(projectId);
  }

  /**
   * Clears all stored evidence.
   * Useful for testing or maintenance.
   */
  clearAll(): void {
    this.storage.clear();
  }

  /**
   * Cleans up expired evidence based on the window duration.
   * Call this periodically to prevent memory growth.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [projectId, decisions] of this.storage.entries()) {
      const validDecisions = decisions.filter((decision) => {
        const storedTime = new Date(decision.storedAt).getTime();
        return now - storedTime < this.options.windowDurationMs;
      });

      if (validDecisions.length === 0) {
        this.storage.delete(projectId);
      } else if (validDecisions.length !== decisions.length) {
        this.storage.set(projectId, validDecisions);
      }

      removedCount += decisions.length - validDecisions.length;
    }

    return removedCount;
  }

  /**
   * Implements OnModuleDestroy to clean up event listeners.
   */
  onModuleDestroy(): void {
    this.unregister();
  }

  /**
   * Unregisters the event listener.
   */
  unregister(): void {
    if (!this.isRegistered) {
      return;
    }

    const emitter = getKanbanEventEmitter();
    emitter.off(
      KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
      this.handleCycleDecisionEvent.bind(this),
    );
    this.isRegistered = false;
    this.logger.log("Unregistered cycle decision event handler");
  }
}

// Re-export types from types file
export type {
  StoredCycleDecisionEvidence,
  CycleDecisionEventHandlerOptions,
} from "./cycle-decision-event.types";
