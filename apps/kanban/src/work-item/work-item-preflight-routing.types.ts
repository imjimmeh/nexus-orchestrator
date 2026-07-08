import type { WorkItemStatus } from "@nexus/kanban-contracts";

export interface RefinementRoutingMeta {
  hasClearedRefinementOnce: boolean;
  retroactiveRefinementRequired: boolean;
  isSplitChild: boolean;
}

export interface PromotionRerouteInput {
  currentStatus: WorkItemStatus;
  requestedStatus: WorkItemStatus;
  hasClearedRefinementOnce: boolean;
  preflightEnabled: boolean;
}

export interface PromotionRerouteDecision {
  effectiveStatus: WorkItemStatus;
  rerouted: boolean;
  reason: "promotion_preflight" | null;
}

export interface DispatchGateInput {
  hasClearedRefinementOnce: boolean;
  preflightRequired: boolean;
}
