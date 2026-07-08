import type {
  DispatchGateInput,
  PromotionRerouteDecision,
  PromotionRerouteInput,
  RefinementRoutingMeta,
} from "./work-item-preflight-routing.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readRefinementRoutingMeta(
  metadata: unknown,
): RefinementRoutingMeta {
  const root = isRecord(metadata) ? metadata : {};
  const refinement = isRecord(root.refinement) ? root.refinement : {};
  const split = isRecord(root.split) ? root.split : {};
  return {
    hasClearedRefinementOnce: refinement.hasClearedRefinementOnce === true,
    retroactiveRefinementRequired:
      refinement.retroactiveRefinementRequired === true,
    isSplitChild:
      typeof split.parentId === "string" && split.parentId.length > 0,
  };
}

export function resolvePromotionReroute(
  input: PromotionRerouteInput,
): PromotionRerouteDecision {
  const passthrough: PromotionRerouteDecision = {
    effectiveStatus: input.requestedStatus,
    rerouted: false,
    reason: null,
  };

  if (!input.preflightEnabled) return passthrough;
  if (input.requestedStatus !== "todo") return passthrough;
  if (input.currentStatus !== "backlog") return passthrough;
  if (input.hasClearedRefinementOnce) return passthrough;

  return {
    effectiveStatus: "refinement",
    rerouted: true,
    reason: "promotion_preflight",
  };
}

export function shouldGateDispatchToRefinement(
  input: DispatchGateInput,
): boolean {
  return input.preflightRequired && !input.hasClearedRefinementOnce;
}
