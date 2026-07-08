import { Injectable } from "@nestjs/common";
import type { Initiative } from "@nexus/kanban-contracts";
import type { KanbanOrchestrationEntity } from "../../database/entities/kanban-orchestration.entity";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";
import { KanbanOrchestrationRepository } from "../../database/repositories/kanban-orchestration.repository";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import type { DecisionEntry } from "../orchestration-internal.types";
import { latestStrategicIntent } from "./strategic-intent-timeline.helpers";
import { computeStalledPullRequests } from "./stalled-pull-request.helpers";
import type {
  ProjectStrategicState,
  StrategicStaleness,
} from "./project-strategic-state.types";

export type { ProjectStrategicState } from "./project-strategic-state.types";

const BURN_RATE_CYCLE_WINDOW = 10;

const COMPLETED_STATUSES: ReadonlySet<string> = new Set([
  "ready-to-merge",
  "awaiting-pr-merge",
  "done",
]);

const EMPTY_STALENESS: StrategicStaleness = {
  lastDiscoveryAt: null,
  mergesSinceDiscovery: 0,
  commitsSinceDiscovery: null,
  lastCharterUpdateAt: null,
  lastInitiativeReviewAt: null,
  lastWorkItemCreatedAt: null,
  backlogDepth: 0,
  recentBurnRatePerCycle: 0,
  starvationForecastCycles: null,
  activeNowInitiativeCount: 0,
  stalledPullRequests: [],
};

@Injectable()
export class ProjectStrategicStateService {
  constructor(
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  async buildStrategicState(
    projectId: string,
    initiatives: Initiative[],
  ): Promise<ProjectStrategicState> {
    const [orchestration, items] = await Promise.all([
      this.orchestrations.findByproject_id(projectId),
      this.workItems.findByproject_id(projectId),
    ]);

    if (!orchestration) {
      return {
        staleness: EMPTY_STALENESS,
        latestStrategicIntent: null,
      };
    }

    const decisionLog = this.toDecisionLog(orchestration);
    const metadata = orchestration.metadata ?? {};
    const lastDiscoveryAt = this.toIsoString(metadata["last_discovery_at"]);
    const lastCharterUpdateAt = this.toIsoString(
      metadata["last_charter_update_at"],
    );

    const mergesSinceDiscovery = this.countMergesSince(items, lastDiscoveryAt);
    const lastInitiativeReviewAt = this.maxInitiativeReview(initiatives);
    const lastWorkItemCreatedAt = this.maxWorkItemCreatedAt(items);
    const backlogDepth = items.filter(
      (item) => item.status === "backlog",
    ).length;
    const recentBurnRatePerCycle = this.computeBurnRate(items, decisionLog);

    const starvationForecastCycles =
      recentBurnRatePerCycle === 0
        ? null
        : backlogDepth / recentBurnRatePerCycle;

    const staleness: StrategicStaleness = {
      lastDiscoveryAt,
      mergesSinceDiscovery,
      commitsSinceDiscovery: null,
      lastCharterUpdateAt,
      lastInitiativeReviewAt,
      lastWorkItemCreatedAt,
      backlogDepth,
      recentBurnRatePerCycle,
      starvationForecastCycles: starvationForecastCycles ?? null,
      activeNowInitiativeCount: this.countActiveNowInitiatives(initiatives),
      stalledPullRequests: computeStalledPullRequests(
        items.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          metadata: item.metadata,
        })),
      ),
    };

    return {
      staleness,
      latestStrategicIntent: latestStrategicIntent(decisionLog),
    };
  }

  private countMergesSince(
    items: KanbanWorkItemEntity[],
    sinceIso: string | null,
  ): number {
    return items.filter((item) => {
      if (!COMPLETED_STATUSES.has(item.status)) return false;
      if (sinceIso === null) return true;
      return item.updated_at.toISOString() > sinceIso;
    }).length;
  }

  private computeBurnRate(
    items: KanbanWorkItemEntity[],
    decisionLog: DecisionEntry[],
  ): number {
    const cycleEntries = decisionLog.filter(
      (entry) => entry.cycleDecision !== undefined,
    );

    if (cycleEntries.length === 0) return 0;

    const windowEntries = cycleEntries.slice(-BURN_RATE_CYCLE_WINDOW);
    const windowStartIso = windowEntries[0]?.timestamp;

    if (!windowStartIso) return 0;

    const completedSinceWindowStart = items.filter(
      (item) =>
        COMPLETED_STATUSES.has(item.status) &&
        item.updated_at.toISOString() >= windowStartIso,
    ).length;

    return completedSinceWindowStart / windowEntries.length;
  }

  private maxInitiativeReview(initiatives: Initiative[]): string | null {
    return this.maxIso(initiatives.map((i) => i.lastReviewedAt));
  }

  private countActiveNowInitiatives(
    initiatives: ReadonlyArray<{ horizon: string; status: string }>,
  ): number {
    return initiatives.filter(
      (initiative) =>
        initiative.horizon === "now" && initiative.status === "active",
    ).length;
  }

  private maxWorkItemCreatedAt(items: KanbanWorkItemEntity[]): string | null {
    return this.maxIso(items.map((item) => item.created_at.toISOString()));
  }

  private maxIso(values: (string | null | undefined)[]): string | null {
    const isoValues = values.filter((v): v is string => typeof v === "string");
    if (isoValues.length === 0) return null;
    return isoValues.reduce((max, val) => (val > max ? val : max));
  }

  private toIsoString(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) return value;
    if (value instanceof Date) return value.toISOString();
    return null;
  }

  private toDecisionLog(entity: KanbanOrchestrationEntity): DecisionEntry[] {
    const raw = entity.decision_log;
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is DecisionEntry => {
      if (entry === null || typeof entry !== "object") return false;
      return (
        "timestamp" in entry &&
        typeof entry["timestamp"] === "string" &&
        "type" in entry &&
        typeof entry["type"] === "string"
      );
    });
  }
}
