import { Injectable } from "@nestjs/common";
import type { KanbanEventDeliveryProjectionEntity } from "../database/entities/kanban-event-delivery-projection.entity";
import type { KanbanOrchestrationEntity } from "../database/entities/kanban-orchestration.entity";
import type { KanbanProjectEntity } from "../database/entities/kanban-project.entity";
import type { KanbanWorkItemEntity } from "../database/entities/kanban-work-item.entity";
import { KanbanEventDeliveryProjectionRepository } from "../database/repositories/kanban-event-delivery-projection.repository";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { narrowMetadataRecord } from "./kanban-retrospective-metadata.helpers";
import type {
  KanbanRetrospectiveDeltaSnapshot,
  KanbanRetrospectiveEvidence,
  RetrospectiveCycleDecisionRecordedEvent,
} from "./retrospective.types";
import { RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT } from "./retrospective.types";

type CountMap = Record<string, number>;

type DecisionLogEntry = {
  timestamp?: string;
  type?: string;
  reasoning?: string;
  actions?: string[];
  cycleDecision?: string;
  idempotencyKey?: string;
};

type ActionRequestEntry = {
  status?: string;
  action?: string;
};

/**
 * Evidence entry derived from a recorded cycle decision event.
 */
type CycleDecisionEventEvidence = {
  decisionType: string;
  reason: string;
  recordedAt: string;
  isSubstantive: boolean;
  idempotencyKey: string | null;
  provenance: {
    workflowRunId: string | null;
    decisionSource: string | null;
  };
};

@Injectable()
export class KanbanRetrospectiveEvidenceService {
  constructor(
    private readonly projects: KanbanProjectRepository,
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly eventProjections: KanbanEventDeliveryProjectionRepository,
  ) {}

  async collectProjectEvidence(
    projectId: string,
  ): Promise<KanbanRetrospectiveEvidence> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      return { state: "missing_project", projectId };
    }

    const orchestration = await this.orchestrations.findByproject_id(projectId);
    if (!orchestration) {
      return { state: "missing_orchestration", projectId };
    }

    const workItems = await this.workItems.findByproject_id(projectId);
    const decisions = this.getDecisionLog(orchestration);
    const actionRequests = this.getActionRequests(orchestration);
    const cycleDecisionEvents = await this.getCycleDecisionEvents(projectId);

    const totalEvidence =
      workItems.length +
      decisions.length +
      actionRequests.length +
      cycleDecisionEvents.length;

    if (totalEvidence === 0) {
      return {
        state: "insufficient_evidence",
        projectId,
        diagnostics: {
          actionRequestCount: actionRequests.length,
          decisionCount: decisions.length,
          workItemCount: workItems.length,
          cycleDecisionEventCount: cycleDecisionEvents.length,
        },
      };
    }

    return {
      state: "ready",
      projectId,
      deltaSnapshot: this.buildDeltaSnapshot(
        project,
        orchestration,
        workItems,
        decisions,
        actionRequests,
        cycleDecisionEvents,
      ),
      cycleDecisionEvents,
    };
  }

  private buildDeltaSnapshot(
    project: KanbanProjectEntity,
    orchestration: KanbanOrchestrationEntity,
    workItems: KanbanWorkItemEntity[],
    decisions: DecisionLogEntry[],
    actionRequests: ActionRequestEntry[],
    cycleDecisionEvents: CycleDecisionEventEvidence[],
  ): KanbanRetrospectiveDeltaSnapshot {
    const metadata = narrowMetadataRecord(orchestration.metadata);

    return {
      project: {
        id: project.id,
        name: project.name,
      },
      orchestration: {
        projectId: orchestration.project_id,
        mode: orchestration.mode,
        status: orchestration.status,
        linkedRunId: orchestration.linked_run_id,
        updatedAt: orchestration.updated_at.toISOString(),
      },
      workItems: {
        total: workItems.length,
        countsByStatus: this.countBy(
          workItems.map((workItem) => workItem.status),
        ),
      },
      decisions: {
        total: decisions.length + cycleDecisionEvents.length,
        latestCycleDecision:
          this.findLatestCycleDecision(decisions) ??
          this.findLatestCycleDecisionFromEvents(cycleDecisionEvents),
        markers: {
          hasDecisionLog: decisions.length > 0,
          hasCycleDecision:
            decisions.some(
              (decision) => this.getCycleDecision(decision) !== null,
            ) || cycleDecisionEvents.length > 0,
          hasCycleDecisionIdempotencyKey:
            decisions.some(
              (decision) => typeof decision.idempotencyKey === "string",
            ) ||
            cycleDecisionEvents.some((event) => event.idempotencyKey !== null),
          hasCycleDecisionRecordedAt:
            typeof metadata.cycle_decision_recorded_at === "string" ||
            cycleDecisionEvents.length > 0,
        },
      },
      actionRequests: {
        total: actionRequests.length,
        countsByStatus: this.countBy(
          actionRequests.map((request) => request.status),
        ),
        countsByAction: this.countBy(
          actionRequests.map((request) => request.action),
        ),
      },
    };
  }

  /**
   * Fetches cycle decision recorded events as evidence sources.
   * These events are emitted when orchestration cycle decisions are completed.
   */
  private async getCycleDecisionEvents(
    projectId: string,
  ): Promise<CycleDecisionEventEvidence[]> {
    const events = await this.eventProjections.listByProject(projectId);

    return events
      .filter((event) => this.isCycleDecisionEvent(event))
      .map((event) => this.extractCycleDecisionEvidence(event));
  }

  /**
   * Checks if an event is a cycle decision recorded event.
   */
  private isCycleDecisionEvent(
    event: KanbanEventDeliveryProjectionEntity,
  ): boolean {
    return event.event_name === RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT;
  }

  /**
   * Extracts evidence from a cycle decision event projection.
   */
  private extractCycleDecisionEvidence(
    event: KanbanEventDeliveryProjectionEntity,
  ): CycleDecisionEventEvidence {
    const payload = narrowMetadataRecord(
      event.payload_snapshot,
    ) as Partial<RetrospectiveCycleDecisionRecordedEvent>;
    const provenance = narrowMetadataRecord(payload.provenance ?? {});

    return {
      decisionType:
        typeof payload.decision_type === "string"
          ? payload.decision_type
          : "unknown",
      reason: typeof payload.reason === "string" ? payload.reason : "",
      recordedAt:
        typeof payload.cycle_decision_recorded_at === "string"
          ? payload.cycle_decision_recorded_at
          : event.created_at.toISOString(),
      isSubstantive:
        typeof payload.is_substantive === "boolean"
          ? payload.is_substantive
          : false,
      idempotencyKey:
        typeof provenance.idempotency_key === "string"
          ? provenance.idempotency_key
          : null,
      provenance: {
        workflowRunId:
          typeof provenance.workflow_run_id === "string"
            ? provenance.workflow_run_id
            : null,
        decisionSource:
          typeof provenance.decision_source === "string"
            ? provenance.decision_source
            : null,
      },
    };
  }

  /**
   * Finds the latest cycle decision from event evidence.
   */
  private findLatestCycleDecisionFromEvents(
    events: CycleDecisionEventEvidence[],
  ): {
    decision: string;
    reasoning: string | null;
    timestamp: string | null;
    idempotencyKey: string | null;
  } | null {
    if (events.length === 0) {
      return null;
    }

    const sorted = events
      .slice()
      .sort(
        (a, b) =>
          new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );

    const latest = sorted[0];
    return {
      decision: latest.decisionType,
      reasoning: latest.reason || null,
      timestamp: latest.recordedAt,
      idempotencyKey: latest.idempotencyKey,
    };
  }

  private getDecisionLog(
    orchestration: KanbanOrchestrationEntity,
  ): DecisionLogEntry[] {
    if (!Array.isArray(orchestration.decision_log)) {
      return [];
    }

    return orchestration.decision_log.filter(
      (entry): entry is DecisionLogEntry => this.isRecord(entry),
    );
  }

  private getActionRequests(
    orchestration: KanbanOrchestrationEntity,
  ): ActionRequestEntry[] {
    if (!Array.isArray(orchestration.action_requests)) {
      return [];
    }

    return orchestration.action_requests.filter(
      (entry): entry is ActionRequestEntry => this.isRecord(entry),
    );
  }

  private findLatestCycleDecision(decisions: DecisionLogEntry[]): {
    decision: string;
    reasoning: string | null;
    timestamp: string | null;
    idempotencyKey: string | null;
  } | null {
    for (const decision of decisions.slice().reverse()) {
      const cycleDecision = this.getCycleDecision(decision);
      if (cycleDecision) {
        return {
          decision: cycleDecision,
          reasoning:
            typeof decision.reasoning === "string" ? decision.reasoning : null,
          timestamp:
            typeof decision.timestamp === "string" ? decision.timestamp : null,
          idempotencyKey:
            typeof decision.idempotencyKey === "string"
              ? decision.idempotencyKey
              : null,
        };
      }
    }

    return null;
  }

  private getCycleDecision(decision: DecisionLogEntry): string | null {
    if (typeof decision.cycleDecision === "string") {
      return decision.cycleDecision;
    }

    const firstAction = Array.isArray(decision.actions)
      ? decision.actions[0]
      : undefined;
    if (decision.type === "cycle_decision" && typeof firstAction === "string") {
      return firstAction;
    }

    return null;
  }

  private countBy(values: Array<string | undefined>): CountMap {
    const counts = values.reduce<CountMap>((result, value) => {
      if (typeof value !== "string" || value.length === 0) {
        return result;
      }

      result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {});

    return Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
