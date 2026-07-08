import type { StrategicIntentPayload } from "./strategic-intent-timeline.types";
import type { StalledPullRequest } from "./stalled-pull-request.types";

export type StrategicStaleness = {
  lastDiscoveryAt: string | null;
  mergesSinceDiscovery: number;
  commitsSinceDiscovery: number | null;
  lastCharterUpdateAt: string | null;
  lastInitiativeReviewAt: string | null;
  lastWorkItemCreatedAt: string | null;
  backlogDepth: number;
  recentBurnRatePerCycle: number;
  starvationForecastCycles: number | null;
  activeNowInitiativeCount: number;
  stalledPullRequests: StalledPullRequest[];
};

export type ProjectStrategicState = {
  staleness: StrategicStaleness;
  latestStrategicIntent: StrategicIntentPayload | null;
};
