import { Injectable } from "@nestjs/common";
import { KanbanOrchestrationFactEntity } from "../../database/entities/kanban-orchestration-fact.entity";
import { KanbanOrchestrationIntentEntity } from "../../database/entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationLaunchAttemptEntity } from "../../database/entities/kanban-orchestration-launch-attempt.entity";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "../../database/entities/kanban-orchestration-scheduler-outcome.entity";
import { KanbanOrchestrationFactRepository } from "../../database/repositories/kanban-orchestration-fact.repository";
import { KanbanOrchestrationIntentRepository } from "../../database/repositories/kanban-orchestration-intent.repository";
import { KanbanOrchestrationLaunchAttemptRepository } from "../../database/repositories/kanban-orchestration-launch-attempt.repository";
import { KanbanOrchestrationSchedulerOutcomeRepository } from "../../database/repositories/kanban-orchestration-scheduler-outcome.repository";
import type {
  ControlPlaneBoardConflictKey,
  ControlPlaneBoardFact,
  ControlPlaneBoardIntent,
  ControlPlaneBoardLane,
  ControlPlaneBoardLaunchAttempt,
  ControlPlaneBoardOutcome,
  ControlPlaneBoardResponse,
} from "./control-plane-board.types";

const ACTIVE_INTENT_STATUSES = new Set(["pending", "launchable", "running"]);

@Injectable()
export class ControlPlaneBoardService {
  constructor(
    private readonly intents: KanbanOrchestrationIntentRepository,
    private readonly facts: KanbanOrchestrationFactRepository,
    private readonly outcomes: KanbanOrchestrationSchedulerOutcomeRepository,
    private readonly launchAttempts: KanbanOrchestrationLaunchAttemptRepository,
  ) {}

  async getProjectBoard(projectId: string): Promise<ControlPlaneBoardResponse> {
    const [intentEntities, factEntities] = await Promise.all([
      this.intents.listByProject(projectId),
      this.facts.listByProject(projectId),
    ]);

    const intentRows = await Promise.all(
      intentEntities.map((intent) => this.toBoardIntent(intent)),
    );
    const boardFacts = factEntities.map((fact) => this.toBoardFact(fact));

    return {
      projectId,
      generatedAt: new Date().toISOString(),
      lanes: this.buildLanes(intentRows),
      facts: boardFacts,
      noLaunchReasons: intentRows
        .map((intent) => intent.latestOutcome)
        .filter(
          (outcome): outcome is ControlPlaneBoardOutcome =>
            outcome !== null && outcome.status !== "launchable",
        ),
      staleLinks: boardFacts.filter(
        (fact) => fact.type === "stale_link_detected",
      ),
    };
  }

  private async toBoardIntent(
    intent: KanbanOrchestrationIntentEntity,
  ): Promise<ControlPlaneBoardIntent> {
    const [outcomeEntities, attemptEntities] = await Promise.all([
      this.outcomes.listByIntent(intent.id),
      this.launchAttempts.listByIntent(intent.id),
    ]);
    const latestOutcome = this.sortOutcomesNewestFirst(outcomeEntities)[0];

    return {
      id: intent.id,
      lane: intent.lane,
      type: intent.type,
      status: intent.status,
      priority: intent.priority,
      reason: intent.reason,
      workflowId: intent.workflow_id,
      workflowScope: intent.workflow_scope,
      conflictKeys: this.toConflictKeys(intent.conflict_keys),
      latestOutcome: latestOutcome ? this.toBoardOutcome(latestOutcome) : null,
      launchAttempts: this.sortAttemptsNewestFirst(attemptEntities).map(
        (attempt) => this.toBoardLaunchAttempt(attempt),
      ),
      createdAt: this.toIsoString(intent.created_at),
      updatedAt: this.toIsoString(intent.updated_at),
    };
  }

  private toBoardOutcome(
    outcome: KanbanOrchestrationSchedulerOutcomeEntity,
  ): ControlPlaneBoardOutcome {
    return {
      id: outcome.id,
      status: outcome.status,
      reason: outcome.reason,
      activeConflicts: this.toConflictKeys(outcome.active_conflicts),
      evaluatedAt: this.toIsoString(outcome.evaluated_at),
    };
  }

  private toBoardLaunchAttempt(
    attempt: KanbanOrchestrationLaunchAttemptEntity,
  ): ControlPlaneBoardLaunchAttempt {
    return {
      id: attempt.id,
      workflowId: attempt.workflow_id,
      workflowRunId: attempt.workflow_run_id,
      status: attempt.status,
      requestedAt: this.toIsoString(attempt.requested_at),
      completedAt: this.toNullableIsoString(attempt.completed_at),
      failureReason: attempt.failure_reason,
    };
  }

  private toBoardFact(
    fact: KanbanOrchestrationFactEntity,
  ): ControlPlaneBoardFact {
    return {
      id: fact.id,
      type: fact.fact_type,
      subjectKind: fact.subject_kind,
      subjectId: fact.subject_id,
      confidence: fact.confidence,
      freshnessStatus: fact.freshness_status,
      observedAt: this.toIsoString(fact.observed_at),
      expiresAt: this.toNullableIsoString(fact.expires_at),
    };
  }

  private buildLanes(
    intents: ControlPlaneBoardIntent[],
  ): ControlPlaneBoardLane[] {
    const lanes = new Map<string, ControlPlaneBoardIntent[]>();
    for (const intent of intents) {
      const laneIntents = lanes.get(intent.lane) ?? [];
      laneIntents.push(intent);
      lanes.set(intent.lane, laneIntents);
    }

    return [...lanes.entries()].map(([lane, laneIntents]) => ({
      lane,
      activeCount: laneIntents.filter((intent) =>
        ACTIVE_INTENT_STATUSES.has(intent.status),
      ).length,
      pendingCount: laneIntents.filter((intent) => intent.status === "pending")
        .length,
      blockedCount: laneIntents.filter((intent) => intent.status === "blocked")
        .length,
      intents: laneIntents,
    }));
  }

  private sortOutcomesNewestFirst(
    outcomes: KanbanOrchestrationSchedulerOutcomeEntity[],
  ): KanbanOrchestrationSchedulerOutcomeEntity[] {
    return [...outcomes].sort(
      (left, right) =>
        this.toTime(right.evaluated_at ?? right.created_at) -
        this.toTime(left.evaluated_at ?? left.created_at),
    );
  }

  private sortAttemptsNewestFirst(
    attempts: KanbanOrchestrationLaunchAttemptEntity[],
  ): KanbanOrchestrationLaunchAttemptEntity[] {
    return [...attempts].sort(
      (left, right) =>
        this.toTime(right.requested_at ?? right.created_at) -
        this.toTime(left.requested_at ?? left.created_at),
    );
  }

  private toConflictKeys(value: unknown): ControlPlaneBoardConflictKey[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const kind = record.kind;
      const keyValue = record.value;
      if (typeof kind !== "string" || typeof keyValue !== "string") return [];
      return [{ kind, value: keyValue }];
    });
  }

  private toNullableIsoString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return this.toIsoString(value);
  }

  private toIsoString(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return new Date(value).toISOString();
    return new Date(value as number).toISOString();
  }

  private toTime(value: unknown): number {
    return new Date(this.toIsoString(value)).getTime();
  }
}
