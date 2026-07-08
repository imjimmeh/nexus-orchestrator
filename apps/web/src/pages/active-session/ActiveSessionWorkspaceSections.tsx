import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowRunTodoList, WorkflowRunTodoStatus } from "@/lib/api/workflow-todos.types";

export { ChatCollaborationSection } from "./ActiveSessionWorkspaceChatCollaborationSection";

export function ControlButtons(
  props: Readonly<{
    hasRunId: boolean;
    supportsPauseResume: boolean;
    isRunPaused: boolean;
    isRunTerminal: boolean;
    pausePending: boolean;
    resumePending: boolean;
    abortPending: boolean;
    onPause: () => void;
    onResume: () => void;
    onAbort: () => void;
  }>,
) {
  const {
    hasRunId,
    supportsPauseResume,
    isRunPaused,
    isRunTerminal,
    pausePending,
    resumePending,
    abortPending,
    onPause,
    onResume,
    onAbort,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        onClick={onPause}
        disabled={
          !hasRunId ||
          !supportsPauseResume ||
          pausePending ||
          isRunPaused ||
          isRunTerminal
        }
      >
        Pause
      </Button>
      <Button
        variant="outline"
        onClick={onResume}
        disabled={
          !hasRunId ||
          !supportsPauseResume ||
          resumePending ||
          !isRunPaused ||
          isRunTerminal
        }
      >
        Resume
      </Button>
      <Button
        variant="destructive"
        onClick={onAbort}
        disabled={!hasRunId || abortPending || isRunTerminal}
      >
        {abortPending ? "Cancelling..." : "Abort"}
      </Button>
    </div>
  );
}

export function ConflictResolutionSection(
  props: Readonly<{
    visible: boolean;
    reason: string | null;
    guidance: string;
    hasRunId: boolean;
    markInProgressPending: boolean;
    instructResolvePending: boolean;
    onGuidanceChange: (value: string) => void;
    onInstructResolve: () => void;
    onMarkInProgress: () => void;
  }>,
) {
  const {
    visible,
    reason,
    guidance,
    hasRunId,
    markInProgressPending,
    instructResolvePending,
    onGuidanceChange,
    onInstructResolve,
    onMarkInProgress,
  } = props;

  if (!visible) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conflict Resolution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This ticket is blocked after an automatic merge failure. Review the
          terminal output, resolve conflicts manually, or instruct the agent to
          resolve them.
        </p>
        {reason && (
          <div className="rounded border bg-muted/30 p-3 text-sm">
            <span className="font-medium">Failure reason:</span> {reason}
          </div>
        )}
        <input
          value={guidance}
          onChange={(event) => {
            onGuidanceChange(event.target.value);
          }}
          placeholder="Optional guidance (e.g., prefer target branch auth changes)"
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={onInstructResolve}
            disabled={!hasRunId || instructResolvePending}
          >
            Instruct Agent to Resolve
          </Button>
          <Button
            variant="secondary"
            onClick={onMarkInProgress}
            disabled={markInProgressPending || instructResolvePending}
          >
            Mark In Progress
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RunTodoListSection(
  props: Readonly<{
    runTodoList: WorkflowRunTodoList | null;
    runTodoListLoading: boolean;
    runTodoListError: string | null;
    runTodoListUpdatePending: boolean;
    hasRunId: boolean;
    onUpdateTodoStatus: (todoId: string, status: WorkflowRunTodoStatus) => void;
  }>,
) {
  const {
    runTodoList,
    runTodoListLoading,
    runTodoListError,
    runTodoListUpdatePending,
    hasRunId,
    onUpdateTodoStatus,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Todo List</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {runTodoListLoading && (
          <p className="text-sm text-muted-foreground">
            Loading run todo list...
          </p>
        )}

        {runTodoListError && (
          <p className="text-sm text-destructive">{runTodoListError}</p>
        )}

        {!runTodoListLoading && !runTodoListError && runTodoList && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">
                {`Total: ${String(runTodoList.summary.total_count)}`}
              </Badge>
              <Badge variant="secondary">
                {`Done: ${String(runTodoList.summary.completed_count)}`}
              </Badge>
              <Badge variant="secondary">
                {`In Progress: ${String(runTodoList.summary.in_progress_count)}`}
              </Badge>
              <Badge variant="secondary">
                {`Not Started: ${String(runTodoList.summary.not_started_count)}`}
              </Badge>
              <Badge variant="outline">
                {`Source: ${runTodoList.source.mode}`}
              </Badge>
            </div>

            {runTodoList.todo_list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No todo items have been recorded for this run yet.
              </p>
            ) : (
              <div className="space-y-2">
                {runTodoList.todo_list.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded border p-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.source_kind === "context_source"
                          ? `Context ${item.source_context_item_id ?? "unknown"}`
                          : "Manual"}
                      </p>
                    </div>
                    <select
                      className="rounded border bg-background px-2 py-1 text-sm"
                      value={item.status}
                      onChange={(event) => {
                        onUpdateTodoStatus(
                          item.id,
                          event.target.value as WorkflowRunTodoStatus,
                        );
                      }}
                      disabled={!hasRunId || runTodoListUpdatePending}
                    >
                      <option value="not-started">not-started</option>
                      <option value="in-progress">in-progress</option>
                      <option value="completed">completed</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
