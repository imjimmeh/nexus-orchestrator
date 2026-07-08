import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  GitMerge,
  Bot,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { MergeWorkItemResponse, WorkItem } from "@/lib/api/work-items.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const WORK_ITEM_QUERY_KEY = "project-work-items";

interface GateBlockedFailure {
  workflowName: string;
  status: string;
  runId: string | null;
}

interface GateBlockedData {
  code: string;
  message: string;
  gate: {
    targetStatus: string;
    failures: GateBlockedFailure[];
  };
}

function isGateBlockedError(
  err: unknown,
): err is { response: { data: GateBlockedData } } {
  const resp = (
    err as { response?: { status?: number; data?: { code?: string } } }
  ).response;
  return resp?.status === 409 && resp.data?.code === "LIFECYCLE_GATE_BLOCKED";
}

interface MergeWorkItemDialogProps {
  item: WorkItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MergeUiState {
  isConflict: boolean;
  isSucceeded: boolean;
  isFailed: boolean;
  hasTriggeredAgentRun: boolean;
  isGateBlocked: boolean;
  gateFailures: GateBlockedFailure[];
}

function getMergeUiState(
  mergeResult: MergeWorkItemResponse | null,
  mutationIsError: boolean,
  mutationError: unknown,
): MergeUiState {
  const outcome = mergeResult?.merge.outcome;
  const gateBlocked = mutationIsError && isGateBlockedError(mutationError);
  const gateFailures = gateBlocked
    ? mutationError.response.data.gate.failures
    : [];
  return {
    isConflict: outcome === "conflict",
    isSucceeded: outcome === "succeeded",
    isFailed:
      !gateBlocked &&
      (outcome === "failed" || (mutationIsError && !mergeResult)),
    hasTriggeredAgentRun: (mergeResult?.triggeredRunIds?.length ?? 0) > 0,
    isGateBlocked: gateBlocked,
    gateFailures,
  };
}

function GateBlockedAlert({ failures }: { failures: GateBlockedFailure[] }) {
  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Blocked by checks</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          The following checks must pass before this item can be merged:
        </p>
        <ul className="space-y-1">
          {failures.map((failure) => (
            <li
              key={failure.workflowName}
              className="flex items-center gap-2 text-xs"
            >
              <span className="font-mono font-medium">
                {failure.workflowName}
              </span>
              <Badge variant="outline" className="text-xs">
                {failure.status}
              </Badge>
              {failure.runId !== null && (
                <a
                  href={`/workflows/runs/${failure.runId}`}
                  className="underline hover:no-underline"
                >
                  View logs
                </a>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function MergeAlerts({
  mergeResult,
  mergeErrorMessage,
  uiState,
}: {
  mergeResult: MergeWorkItemResponse | null;
  mergeErrorMessage?: string;
  uiState: MergeUiState;
}) {
  return (
    <>
      {uiState.isGateBlocked && (
        <GateBlockedAlert failures={uiState.gateFailures} />
      )}

      {uiState.isSucceeded && mergeResult && (
        <Alert>
          <GitMerge className="h-4 w-4" />
          <AlertTitle>Merge Successful</AlertTitle>
          <AlertDescription>{mergeResult.merge.message}</AlertDescription>
        </Alert>
      )}

      {uiState.isConflict && mergeResult && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Merge Conflicts Detected</AlertTitle>
          <AlertDescription>
            <p className="mb-2">{mergeResult.merge.message}</p>
            {mergeResult.merge.conflictedFiles.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Conflicted files:</p>
                <div className="flex flex-wrap gap-1">
                  {mergeResult.merge.conflictedFiles.map((file) => (
                    <Badge
                      key={file}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {file}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {uiState.isFailed && !uiState.isConflict && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Merge Failed</AlertTitle>
          <AlertDescription>
            {mergeResult?.merge.message ??
              mergeErrorMessage ??
              "An unexpected error occurred during merge."}
          </AlertDescription>
        </Alert>
      )}

      {uiState.hasTriggeredAgentRun && (
        <Alert>
          <Bot className="h-4 w-4" />
          <AlertTitle>Agent Dispatched</AlertTitle>
          <AlertDescription>
            An agent has been assigned to resolve merge conflicts. The work item
            has been moved to blocked status.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

function MergeFooterActions({
  uiState,
  isPending,
  sourceBranch,
  onMerge,
  onDelegate,
}: {
  uiState: MergeUiState;
  isPending: boolean;
  sourceBranch: string;
  onMerge: () => void;
  onDelegate: () => void;
}) {
  return (
    <DialogFooter className="gap-2">
      {uiState.isConflict && !uiState.hasTriggeredAgentRun && (
        <Button variant="secondary" onClick={onDelegate} disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Bot className="mr-1 h-4 w-4" />
          )}
          Send to Agent
        </Button>
      )}

      {!uiState.isSucceeded && !uiState.hasTriggeredAgentRun && (
        <Button onClick={onMerge} disabled={isPending || !sourceBranch}>
          {isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="mr-1 h-4 w-4" />
          )}
          {uiState.isConflict ? "Retry Merge" : "Merge"}
        </Button>
      )}
    </DialogFooter>
  );
}

export function MergeWorkItemDialog({
  item,
  open,
  onOpenChange,
}: Readonly<MergeWorkItemDialogProps>) {
  const queryClient = useQueryClient();
  const sourceBranch = item.executionConfig?.targetBranch ?? "";
  const defaultDestination = item.executionConfig?.baseBranch ?? "";
  const [destinationBranch, setDestinationBranch] =
    useState(defaultDestination);
  const [mergeResult, setMergeResult] = useState<MergeWorkItemResponse | null>(
    null,
  );

  const { data: branches = [] } = useQuery({
    queryKey: ["project-branches", item.project_id],
    queryFn: () => api.getProjectRepositoryBranches(item.project_id),
    enabled: open,
  });

  const mergeMutation = useMutation({
    mutationFn: (delegateConflictsToAgent: boolean) =>
      api.mergeWorkItem(item.project_id, item.id, {
        destinationBranch:
          destinationBranch === defaultDestination
            ? undefined
            : destinationBranch,
        delegateConflictsToAgent,
      }),
    onSuccess: (result) => {
      setMergeResult(result);
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, item.project_id],
        (current = []) =>
          current.map((i) =>
            i.id === result.workItem.id ? result.workItem : i,
          ),
      );

      if (result.merge.outcome === "succeeded") {
        setTimeout(() => {
          onOpenChange(false);
          setMergeResult(null);
        }, 1500);
      }
    },
  });

  const handleMerge = () => {
    setMergeResult(null);
    mergeMutation.mutate(false);
  };

  const handleDelegateToAgent = () => {
    mergeMutation.mutate(true);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setMergeResult(null);
      setDestinationBranch(defaultDestination);
    }
    onOpenChange(isOpen);
  };

  const uiState = getMergeUiState(
    mergeResult,
    mergeMutation.isError,
    mergeMutation.error,
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Merge Work Item Branch
          </DialogTitle>
          <DialogDescription>
            Merge <code className="font-mono text-xs">{sourceBranch}</code> into
            the target branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Source Branch</Label>
            <div className="rounded border bg-muted px-3 py-2">
              <code className="text-sm font-mono">{sourceBranch}</code>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination-branch">Destination Branch</Label>
            {branches.length > 0 ? (
              <Select
                value={destinationBranch}
                onValueChange={setDestinationBranch}
              >
                <SelectTrigger id="destination-branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches
                    .filter((b) => b !== sourceBranch)
                    .map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                        {branch === defaultDestination && " (default)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded border bg-muted px-3 py-2">
                <code className="text-sm font-mono">{destinationBranch}</code>
              </div>
            )}
          </div>

          <MergeAlerts
            mergeResult={mergeResult}
            mergeErrorMessage={mergeMutation.error?.message}
            uiState={uiState}
          />
        </div>

        <MergeFooterActions
          uiState={uiState}
          isPending={mergeMutation.isPending}
          sourceBranch={sourceBranch}
          onMerge={handleMerge}
          onDelegate={handleDelegateToAgent}
        />
      </DialogContent>
    </Dialog>
  );
}
