import { Loader2, ShieldAlert } from "lucide-react";
import { WorkItem } from "@/lib/api/work-items.types";
import { readGateMarker, type GateState } from "./kanban-gate-state";
import { getKanbanColumnTitle } from "./kanban.utils";

interface Props {
  readonly item: WorkItem;
  readonly gateState: GateState;
}

export function KanbanWorkItemGateBadge({ item, gateState }: Props) {
  if (gateState === "none") return null;

  if (gateState === "running") {
    return (
      <div className="mt-2 inline-flex items-center gap-1 rounded bg-info/10 px-2 py-1 text-xs text-info">
        <Loader2 className="h-3 w-3 animate-spin" />
        Entering next column…
      </div>
    );
  }

  const marker = readGateMarker(item);
  const target = marker
    ? getKanbanColumnTitle(marker.targetStatus)
    : "next column";
  const firstFailure = marker?.failures[0]?.workflowName;

  return (
    <div className="mt-2 inline-flex items-center gap-1 rounded bg-error/10 px-2 py-1 text-xs text-error">
      <ShieldAlert className="h-3 w-3" />
      Held at gate → {target}
      {firstFailure ? ` · ${firstFailure} ✗` : ""}
    </div>
  );
}
