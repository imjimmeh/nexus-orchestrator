import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, MessageSquare, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrchestrationModeHint } from "@/components/orchestration/OrchestrationModeHint";
import { ProjectOrchestration, ProjectOrchestrationMode } from "@/lib/api/projects.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import {
  getRunBadgeVariant,
  statusAllowsPause,
} from "./OrchestrationTab.helpers";

interface OrchestrationControlsCardProps {
  orchestration: ProjectOrchestration | null;
  workflowRun?: WorkflowRun | null;
  currentRunId: string | null;
  pendingQuestionCount: number;
  pendingActionCount: number;
  activeSessionHref: string | null;
  steeringActive?: boolean;
  onSteerProject?: () => void;
  onCloseSteering?: () => void;
  onOpenStartDialog: () => void;
  onPause: () => void;
  onResume: () => void;
  onRecoverImportedHydration: () => void;
  onAbort: () => void;
  onComplete: () => void;
  onResetBlockedIntents: () => void;
  isAbortPending: boolean;
  isCompletePending: boolean;
  isRecoverImportedHydrationPending: boolean;
  isResetIntentsPending: boolean;
  canRecoverImportedHydration: boolean;
  onModeChange: (mode: ProjectOrchestrationMode) => void;
}

const START_DISABLED_STATUSES = new Set([
  "initializing",
  "awaiting_approval",
  "bootstrapping",
  "orchestrating",
  "paused",
]);

function ControlsHeaderBadges(
  props: Readonly<{
    orchestration: ProjectOrchestration | null;
    workflowRun?: WorkflowRun | null;
    currentRunId: string | null;
    pendingQuestionCount: number;
    steeringActive?: boolean;
  }>,
) {
  const {
    orchestration,
    workflowRun,
    currentRunId,
    pendingQuestionCount,
    steeringActive,
  } = props;

  if (!orchestration) {
    return <Badge variant="outline">idle</Badge>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">Lifecycle: {orchestration.status}</Badge>
      <Badge
        variant={getRunBadgeVariant(
          workflowRun?.status ?? (currentRunId ? "loading" : "none"),
        )}
      >
        Run: {workflowRun?.status ?? (currentRunId ? "loading" : "none")}
      </Badge>
      {pendingQuestionCount > 0 && (
        <Badge variant="destructive">Input Needed</Badge>
      )}
      {steeringActive && <Badge variant="default">Steering Active</Badge>}
    </div>
  );
}

function resolvePrimaryActionState(params: {
  orchestration: ProjectOrchestration | null;
  workflowRun?: WorkflowRun | null;
  currentRunId: string | null;
}) {
  const runStatus =
    params.workflowRun?.status ?? (params.currentRunId ? "loading" : "none");
  const isRestartState =
    params.orchestration?.status === "failed" ||
    params.orchestration?.status === "completed";
  const startVariant: NonNullable<ButtonProps["variant"]> =
    params.orchestration?.status === "failed" ? "destructive" : "default";
  const startLabel = isRestartState ? "Restart" : "Start";
  const canStartOrRestart = params.orchestration
    ? !START_DISABLED_STATUSES.has(params.orchestration.status)
    : true;
  const canPause = params.orchestration
    ? statusAllowsPause(params.orchestration.status)
    : false;
  const canComplete = params.orchestration
    ? params.orchestration.status !== "completed" &&
      params.orchestration.status !== "failed"
    : false;

  return {
    runStatus,
    startVariant,
    startLabel,
    canStartOrRestart,
    canPause,
    canComplete,
  };
}

function PendingApprovalsAction(
  props: Readonly<{ pendingActionCount: number }>,
) {
  if (props.pendingActionCount <= 0) {
    return null;
  }

  return (
    <Button variant="secondary" asChild>
      <a href="#orchestration-approvals">Go to approvals</a>
    </Button>
  );
}

function ActiveSessionAction(
  props: Readonly<{ activeSessionHref: string | null }>,
) {
  if (!props.activeSessionHref) {
    return null;
  }

  return (
    <Button variant="secondary" asChild>
      <Link to={props.activeSessionHref}>Go to Active Session</Link>
    </Button>
  );
}

function WorkflowRunAction(
  props: Readonly<{ workflowRun?: WorkflowRun | null }>,
) {
  if (!props.workflowRun?.id || !props.workflowRun.workflow_id) {
    return null;
  }

  return (
    <Button variant="outline" asChild>
      <Link
        to={`/workflows/${props.workflowRun.workflow_id}/runs/${props.workflowRun.id}`}
      >
        Open Workflow Run
      </Link>
    </Button>
  );
}

function OrchestrationPrimaryActions(
  props: Readonly<{
    orchestration: ProjectOrchestration | null;
    workflowRun?: WorkflowRun | null;
    currentRunId: string | null;
    pendingActionCount: number;
    activeSessionHref: string | null;
    steeringActive?: boolean;
    onSteerProject?: () => void;
    onCloseSteering?: () => void;
    onOpenStartDialog: () => void;
    onPause: () => void;
    onResume: () => void;
    onRecoverImportedHydration: () => void;
    onAbort: () => void;
    onComplete: () => void;
    onResetBlockedIntents: () => void;
    isAbortPending: boolean;
    isCompletePending: boolean;
    isRecoverImportedHydrationPending: boolean;
    isResetIntentsPending: boolean;
    canRecoverImportedHydration: boolean;
  }>,
) {
  const {
    orchestration,
    workflowRun,
    currentRunId,
    pendingActionCount,
    activeSessionHref,
    steeringActive,
    onSteerProject,
    onCloseSteering,
    onOpenStartDialog,
    onPause,
    onResume,
    onRecoverImportedHydration,
    onAbort,
    onComplete,
    onResetBlockedIntents,
    isAbortPending,
    isCompletePending,
    isRecoverImportedHydrationPending,
    isResetIntentsPending,
    canRecoverImportedHydration,
  } = props;
  const {
    runStatus,
    startVariant,
    startLabel,
    canStartOrRestart,
    canPause,
    canComplete,
  } = resolvePrimaryActionState({
    orchestration,
    workflowRun,
    currentRunId,
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={onOpenStartDialog}
        variant={startVariant}
        disabled={!canStartOrRestart}
      >
        {startLabel}
      </Button>
      <PendingApprovalsAction pendingActionCount={pendingActionCount} />
      {steeringActive ? (
        <Button variant="outline" onClick={onCloseSteering}>
          <X className="mr-1 h-4 w-4" />
          Close Steering
        </Button>
      ) : (
        orchestration && (
          <Button variant="outline" onClick={onSteerProject}>
            <MessageSquare className="mr-1 h-4 w-4" />
            Steer Project
          </Button>
        )
      )}
      {canRecoverImportedHydration && (
        <Button
          variant="secondary"
          onClick={onRecoverImportedHydration}
          disabled={isRecoverImportedHydrationPending}
        >
          Recover Import Hydration
        </Button>
      )}
      <Button variant="outline" onClick={onPause} disabled={!canPause}>
        Pause
      </Button>
      <Button
        variant="outline"
        onClick={onResume}
        disabled={orchestration?.status !== "paused"}
      >
        Resume
      </Button>
      <Button
        variant="destructive"
        onClick={onAbort}
        disabled={!currentRunId || isAbortPending}
        title={
          currentRunId ? undefined : "No linked workflow run is available."
        }
      >
        Abort Run
      </Button>
      <Button
        variant="outline"
        onClick={onComplete}
        disabled={!canComplete || isCompletePending}
      >
        {isCompletePending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isCompletePending ? "Completing..." : "Complete"}
      </Button>
      {orchestration && (
        <Button
          variant="secondary"
          onClick={onResetBlockedIntents}
          disabled={isResetIntentsPending}
        >
          Reset Blocked Intents
        </Button>
      )}
      <ActiveSessionAction activeSessionHref={activeSessionHref} />
      {runStatus && <WorkflowRunAction workflowRun={workflowRun} />}
    </div>
  );
}

export function OrchestrationControlsCard({
  orchestration,
  workflowRun,
  currentRunId,
  pendingQuestionCount,
  pendingActionCount,
  activeSessionHref,
  steeringActive,
  onSteerProject,
  onCloseSteering,
  onOpenStartDialog,
  onPause,
  onResume,
  onRecoverImportedHydration,
  onAbort,
  onComplete,
  onResetBlockedIntents,
  isAbortPending,
  isCompletePending,
  isRecoverImportedHydrationPending,
  isResetIntentsPending,
  canRecoverImportedHydration,
  onModeChange,
}: Readonly<OrchestrationControlsCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Orchestration Controls</span>
          <ControlsHeaderBadges
            orchestration={orchestration}
            workflowRun={workflowRun}
            currentRunId={currentRunId}
            pendingQuestionCount={pendingQuestionCount}
            steeringActive={steeringActive}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <OrchestrationPrimaryActions
          orchestration={orchestration}
          workflowRun={workflowRun}
          currentRunId={currentRunId}
          pendingActionCount={pendingActionCount}
          activeSessionHref={activeSessionHref}
          steeringActive={steeringActive}
          onSteerProject={onSteerProject}
          onCloseSteering={onCloseSteering}
          onOpenStartDialog={onOpenStartDialog}
          onPause={onPause}
          onResume={onResume}
          onRecoverImportedHydration={onRecoverImportedHydration}
          onAbort={onAbort}
          onComplete={onComplete}
          onResetBlockedIntents={onResetBlockedIntents}
          isAbortPending={isAbortPending}
          isCompletePending={isCompletePending}
          isRecoverImportedHydrationPending={isRecoverImportedHydrationPending}
          isResetIntentsPending={isResetIntentsPending}
          canRecoverImportedHydration={canRecoverImportedHydration}
        />

        {orchestration && (
          <div className="space-y-2">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={orchestration.orchestrationMode}
                onValueChange={(value) =>
                  onModeChange(value as ProjectOrchestrationMode)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supervised">supervised</SelectItem>
                  <SelectItem value="autonomous">autonomous</SelectItem>
                  <SelectItem value="notifications_only">
                    notifications_only
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {orchestration && (
          <OrchestrationModeHint mode={orchestration.orchestrationMode} />
        )}
      </CardContent>
    </Card>
  );
}
