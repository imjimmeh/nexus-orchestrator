import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { OrchestrationDecisionTimeline } from "@/components/orchestration/OrchestrationDecisionTimeline";
import { OrchestrationPendingActionsPanel } from "@/components/orchestration/OrchestrationPendingActionsPanel";
import { OrchestrationStatusCard } from "@/components/orchestration";
import { OrchestrationCapabilityHealthCard } from "@/components/orchestration/OrchestrationCapabilityHealthCard";
import { AgentCommunicationThreadPanel } from "@/components/orchestration/AgentCommunicationThreadPanel";
import { WarRoomSessionManagerPanel } from "@/components/orchestration/WarRoomSessionManagerPanel";
import { WarRoomSessionPanel } from "@/components/orchestration/WarRoomSessionPanel";
import { OrchestrationNotificationFeed } from "@/components/notifications/OrchestrationNotificationFeed";
import { OrchestrationImportHydrationBanner } from "./OrchestrationImportHydrationBanner";
import { ControlPlaneBoard } from "@/features/control-plane/ControlPlaneBoard";
import { fetchControlPlaneBoard } from "@/features/control-plane/controlPlaneApi";
import { ProjectOrchestrationDiagnostics, ReplayProjectRetrospectiveRequest, RuntimeCapabilitiesSnapshot } from "@/lib/api/orchestration.types";
import { ProjectOrchestration, ProjectOrchestrationActionRequest, ProjectStateSnapshot } from "@/lib/api/projects.types";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { OrchestrationNotification } from "@/components/notifications/OrchestrationNotificationFeed";

interface OrchestrationDetailsSectionProps {
  projectId: string;
  currentRunId: string | null;
  orchestration: ProjectOrchestration | null;
  projectState: ProjectStateSnapshot | undefined;
  workflowRun: WorkflowRun | undefined;
  workflowRunEvents: WorkflowTelemetryEvent[];
  activeSessionHref: string | null;
  hasPendingQuestions: boolean;
  isRunCorrelationInferred: boolean;
  pendingActionRequests: ProjectOrchestrationActionRequest[];
  notifications: OrchestrationNotification[];
  diagnostics?: ProjectOrchestrationDiagnostics;
  capabilities?: RuntimeCapabilitiesSnapshot;
  diagnosticsLoading: boolean;
  capabilitiesLoading: boolean;
  diagnosticsError?: string | null;
  capabilitiesError?: string | null;
  onApproveActionRequest: (actionRequestId: string) => Promise<void>;
  onRejectActionRequest: (params: {
    actionRequestId: string;
    reason: string;
  }) => Promise<void>;
  isActionMutationPending: boolean;
  onReplayRetrospective: (
    mode: ReplayProjectRetrospectiveRequest["mode"],
  ) => Promise<void>;
  isReplayRetrospectivePending: boolean;
}

export function OrchestrationDetailsSection({
  projectId,
  currentRunId,
  orchestration,
  projectState,
  workflowRun,
  workflowRunEvents,
  activeSessionHref,
  hasPendingQuestions,
  isRunCorrelationInferred,
  pendingActionRequests,
  notifications,
  diagnostics,
  capabilities,
  diagnosticsLoading,
  capabilitiesLoading,
  diagnosticsError,
  capabilitiesError,
  onApproveActionRequest,
  onRejectActionRequest,
  isActionMutationPending,
  onReplayRetrospective,
  isReplayRetrospectivePending,
}: Readonly<OrchestrationDetailsSectionProps>) {
  const controlPlaneBoardQuery = useQuery({
    queryKey: ["control-plane-board", projectId],
    queryFn: () => fetchControlPlaneBoard(projectId),
    enabled: Boolean(orchestration),
    refetchInterval: 10_000,
  });

  if (!orchestration || !projectState) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Orchestration has not been started for this project yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <OrchestrationImportHydrationBanner orchestration={orchestration} />
      <OrchestrationCapabilityHealthCard
        diagnostics={diagnostics}
        capabilities={capabilities}
        diagnosticsLoading={diagnosticsLoading}
        capabilitiesLoading={capabilitiesLoading}
        diagnosticsError={diagnosticsError}
        capabilitiesError={capabilitiesError}
        onReplayRetrospective={onReplayRetrospective}
        replayRetrospectivePending={isReplayRetrospectivePending}
      />
      <OrchestrationStatusCard
        orchestration={orchestration}
        projectState={projectState}
        workflowRun={workflowRun}
        workflowEvents={workflowRunEvents}
        activeSessionHref={activeSessionHref}
        hasPendingQuestions={hasPendingQuestions}
        isRunCorrelationInferred={isRunCorrelationInferred}
      />
      {controlPlaneBoardQuery.data ? (
        <ControlPlaneBoard board={controlPlaneBoardQuery.data} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {controlPlaneBoardQuery.isError
                ? "Control-plane board is unavailable."
                : "Loading control-plane board..."}
            </p>
          </CardContent>
        </Card>
      )}
      <div id="orchestration-approvals">
        <OrchestrationPendingActionsPanel
          requests={pendingActionRequests}
          onApprove={onApproveActionRequest}
          onReject={onRejectActionRequest}
          isPending={isActionMutationPending}
        />
      </div>
      <OrchestrationDecisionTimeline
        entries={orchestration.decisionLog ?? []}
      />
      <AgentCommunicationThreadPanel events={workflowRunEvents} />
      <WarRoomSessionManagerPanel
        projectId={projectId}
        workflowRunId={currentRunId}
      />
      <WarRoomSessionPanel events={workflowRunEvents} />
      <OrchestrationNotificationFeed items={notifications} />
    </>
  );
}
