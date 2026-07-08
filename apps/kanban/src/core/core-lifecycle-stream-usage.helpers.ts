import type { CoreWorkflowEventEnvelopeV1Shape } from "@nexus/core";

type Payload = CoreWorkflowEventEnvelopeV1Shape["payload"];

export function readUsageTotalTokens(payload: Payload): number {
  if (!("usage" in payload) || !payload.usage) {
    return 0;
  }

  const total = payload.usage.total_tokens;
  return typeof total === "number" && Number.isFinite(total) && total > 0
    ? total
    : 0;
}

export function readUsageEstimatedCostCents(payload: Payload): number {
  if (!("usage" in payload) || !payload.usage) {
    return 0;
  }

  const rawUsage = payload.usage as Record<string, unknown>;
  const cents = rawUsage["estimated_cost_cents"];
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0
    ? cents
    : 0;
}
