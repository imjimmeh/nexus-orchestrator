import { LifecycleGateMarker, WorkItem } from "@/lib/api/work-items.types";
import type { GateState } from "./kanban-gate-state.types";

export type { GateState } from "./kanban-gate-state.types";

export function readGateMarker(item: WorkItem): LifecycleGateMarker | null {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const lifecycle = (metadata as Record<string, unknown>).lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") return null;
  const gate = (lifecycle as Record<string, unknown>).gate;
  if (!gate || typeof gate !== "object") return null;
  if ((gate as Record<string, unknown>).status !== "held") return null;
  return gate as unknown as LifecycleGateMarker;
}

export function deriveGateState(
  item: WorkItem,
  isTransitionPending: boolean,
): GateState {
  if (isTransitionPending) return "running";
  return readGateMarker(item) ? "held" : "none";
}
