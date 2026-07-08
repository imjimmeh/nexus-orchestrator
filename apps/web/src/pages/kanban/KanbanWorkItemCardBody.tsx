import { AlertCircle, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkItem, WorkItemLiveState } from "@/lib/api/work-items.types";
import type { DecisionMetadata } from "./kanban-card-ui.types";
import { KanbanWorkItemDecisionMetadataBanners } from "./KanbanWorkItemDecisionMetadataBanners";
import { KanbanWorkItemCardMetaBadges } from "./KanbanWorkItemCardMetaBadges";
import { KanbanWorkItemCardFooterStats } from "./KanbanWorkItemCardFooterStats";
import { KanbanWorkItemGateBadge } from "./KanbanWorkItemGateBadge";
import type { GateState } from "./kanban-gate-state";

function AssignedAgent({ agentId }: Readonly<{ agentId?: string | null }>) {
  return agentId ? (
    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
      <Cpu className="h-3 w-3" />
      {agentId}
    </div>
  ) : null;
}

interface KanbanWorkItemCardBodyProps {
  item: WorkItem;
  liveState: WorkItemLiveState;
  autoCompletedReason: string | null;
  blockerCount: number;
  dependencyCount: number;
  planState: string;
  progressPercent: number;
  hasActiveSession: boolean;
  decisionMetadata: DecisionMetadata | null;
  gateState: GateState;
  onConfigure: (itemId: string) => void;
}

export function KanbanWorkItemCardBody({
  item,
  liveState,
  autoCompletedReason,
  blockerCount,
  dependencyCount,
  planState,
  progressPercent,
  hasActiveSession,
  decisionMetadata,
  gateState,
  onConfigure,
}: Readonly<KanbanWorkItemCardBodyProps>) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="line-clamp-2 font-medium leading-snug">{item.title}</p>
        <div className="flex items-center gap-1">
          {autoCompletedReason ? (
            <Badge
              variant="secondary"
              title="Auto-completed: parent epic completed directly"
            >
              Auto
            </Badge>
          ) : null}
          <Badge variant="outline" className="uppercase">
            {item.priority}
          </Badge>
        </div>
      </div>

      {item.description ? (
        <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
          {item.description}
        </p>
      ) : null}

      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <KanbanWorkItemCardMetaBadges
        item={item}
        blockerCount={blockerCount}
        planState={planState}
      />

      <KanbanWorkItemCardFooterStats
        liveState={liveState}
        dependencyCount={dependencyCount}
        tokenSpend={item.tokenSpend || 0}
        costCents={item.costCents}
      />

      <AssignedAgent agentId={item.assignedAgentId} />

      {blockerCount > 0 ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded bg-error/10 px-2 py-1 text-xs text-error">
          <AlertCircle className="h-3 w-3" />
          Blocked by {blockerCount}
        </div>
      ) : null}

      <KanbanWorkItemGateBadge item={item} gateState={gateState} />

      {hasActiveSession ? (
        <div className="mt-2 rounded bg-success/15 px-2 py-1 text-xs text-success">
          Session active
        </div>
      ) : null}

      <KanbanWorkItemDecisionMetadataBanners
        decisionMetadata={decisionMetadata}
      />

      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pointer-events-auto relative z-10"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure(item.id);
          }}
        >
          Configure
        </Button>
      </div>
    </>
  );
}
