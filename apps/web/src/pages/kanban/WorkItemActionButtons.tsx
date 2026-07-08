import { Edit2, GitMerge, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WorkItemActionButtonsProps {
  isEditing: boolean;
  hasActiveSession: boolean;
  hasCurrentRun: boolean;
  canMerge: boolean;
  canRestartExecution: boolean;
  isRestartingExecution: boolean;
  isDeleting: boolean;
  onStartEditing: () => void;
  onOpenActiveSession: () => void;
  onOpenCurrentRun: () => void;
  onOpenMerge: () => void;
  onRestartExecution: () => void;
  onDelete: () => void;
}

export function WorkItemActionButtons({
  isEditing,
  hasActiveSession,
  hasCurrentRun,
  canMerge,
  canRestartExecution,
  isRestartingExecution,
  isDeleting,
  onStartEditing,
  onOpenActiveSession,
  onOpenCurrentRun,
  onOpenMerge,
  onRestartExecution,
  onDelete,
}: Readonly<WorkItemActionButtonsProps>) {
  return (
    <div className="flex flex-wrap gap-2">
      {!isEditing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onStartEditing}
          aria-label="Edit work item"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
      )}
      {hasActiveSession && (
        <Button variant="outline" size="sm" onClick={onOpenActiveSession}>
          Open Active Session
        </Button>
      )}
      {hasCurrentRun && (
        <Button variant="outline" size="sm" onClick={onOpenCurrentRun}>
          Open Workflow Run
        </Button>
      )}
      {canMerge && (
        <Button size="sm" onClick={onOpenMerge}>
          <GitMerge className="mr-1 h-4 w-4" />
          Merge Branch
        </Button>
      )}
      {canRestartExecution && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRestartExecution}
          disabled={isRestartingExecution}
        >
          {isRestartingExecution ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-1 h-4 w-4" />
          )}
          Retrigger Execution
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-1 h-4 w-4" />
        )}
        Delete
      </Button>
    </div>
  );
}
