import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useWorkflowSubagentExecutions } from "@/hooks/useWorkflowSubagentExecutions";
import type { WorkflowSubagentExecutionSummary } from "@/hooks/useWorkflowSubagentExecutions.types";
import { SubagentExecutionRow } from "./subagent-execution-row";

const SUBAGENT_SESSION_STATUSES = "RUNNING,STARTING,COMPLETED,FAILED,CANCELLED";

function getExecutionDisplayStatus(
  execution: WorkflowSubagentExecutionSummary,
  sessionStatusById: ReadonlyMap<string, string>,
): string {
  if (execution.subagentChatSessionId) {
    const sessionStatus = sessionStatusById.get(
      execution.subagentChatSessionId,
    );
    if (sessionStatus) {
      return sessionStatus;
    }
  }

  return execution.status.toUpperCase();
}

export function SubagentExecutionPanel({
  workflowRunId,
}: Readonly<{ workflowRunId: string }>) {
  const [isExpanded, setIsExpanded] = useState(true);
  const subagentData = useWorkflowSubagentExecutions(workflowRunId);
  const subagentSessions = useChatSessions({
    status: SUBAGENT_SESSION_STATUSES,
    limit: 500,
    offset: 0,
    refetchIntervalMs: 3000,
  });
  const sessionStatusById = useMemo(() => {
    const nextStatusById = new Map<string, string>();
    for (const session of subagentSessions.data?.data ?? []) {
      if (
        session.source === "subagent" &&
        session.workflowRunId === workflowRunId
      ) {
        nextStatusById.set(session.id, session.status);
      }
    }

    return nextStatusById;
  }, [subagentSessions.data?.data, workflowRunId]);

  return (
    <div
      className={`${
        isExpanded ? "w-96" : "w-12"
      } border-l bg-muted/20 p-3 overflow-y-auto`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? "Collapse subagent executions"
            : "Expand subagent executions"
        }
        className="flex w-full items-center gap-1 text-sm font-semibold"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        {isExpanded && <span>Subagent Executions</span>}
      </button>
      {isExpanded &&
        (subagentData.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Loading subagent activity...
          </p>
        ) : subagentData.executions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No subagent executions recorded for this run.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {subagentData.executions.map((execution) => {
              const displayStatus = getExecutionDisplayStatus(
                execution,
                sessionStatusById,
              );

              return (
                <SubagentExecutionRow
                  key={execution.id}
                  id={execution.id}
                  displayStatus={displayStatus}
                  lastEventName={execution.lastEventName}
                />
              );
            })}
          </div>
        ))}
    </div>
  );
}
