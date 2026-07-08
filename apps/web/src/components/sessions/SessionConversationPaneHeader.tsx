import { Menu } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SessionConversationPaneHeaderProps {
  title: string;
  status: string | undefined;
  connectionState: string;
  isChatSession: boolean;
  projectName: string | null | undefined;
  workflowId: string | undefined;
  workflowRunId: string | undefined;
  canAbortWorkflowRun: boolean;
  onAbort: () => void;
  isAbortPending: boolean;
  onShowExecution: () => void;
}

export function SessionConversationPaneHeader({
  title,
  status,
  connectionState,
  isChatSession,
  projectName,
  workflowId,
  workflowRunId,
  canAbortWorkflowRun,
  onAbort,
  isAbortPending,
  onShowExecution,
}: Readonly<SessionConversationPaneHeaderProps>) {
  return (
    <div className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex-1">
        {workflowId && workflowRunId ? (
          <Link
            to={`/workflows/${workflowId}/runs/${workflowRunId}`}
            className="text-lg font-semibold underline-offset-2 hover:underline"
          >
            {title}
          </Link>
        ) : (
          <h2 className="text-lg font-semibold">{title}</h2>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs">
            {status}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {connectionState}
          </Badge>
          {isChatSession && projectName ? (
            <span className="text-xs text-muted-foreground">{projectName}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canAbortWorkflowRun ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onAbort}
            disabled={isAbortPending}
          >
            Abort Run
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={onShowExecution}
          title="Show execution details (terminal, diff, file tree)"
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
