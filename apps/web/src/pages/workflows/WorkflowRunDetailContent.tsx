import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowRunDetailHeader } from "./WorkflowRunDetailHeader";
import { WorkflowRunPhasesBanner } from "./WorkflowRunPhasesBanner";
import { WorkflowRunGraphTab } from "./WorkflowRunGraphTab";
import { WorkflowRunChatTab } from "./WorkflowRunChatTab";
import { WorkflowRunEventsTab } from "./WorkflowRunEventsTab";
import { WorkflowRunSubagentsTab } from "./WorkflowRunSubagentsTab";
import { WorkflowRunDiagnosticsStrip } from "./WorkflowRunDiagnosticsStrip";
import type { WorkflowRunDetailContentProps } from "./WorkflowRunDetailContent.types";
import { useActivityFilter } from "./useActivityFilter";

export function WorkflowRunDetailContent(props: WorkflowRunDetailContentProps) {
  const {
    run,
    workflowId,
    connectionState,
    telemetryError,
    phaseMarkers,
    events,
    isLoadingTelemetry,
    chatMessages,
    chatEmptyMessage,
    message,
    onMessageChange,
    onInjectMessage,
    isInjectingMessage,
    pendingQuestions,
    onSubmitAnswers,
    isSubmittingAnswers,
    isInteractive,
    stepOutputs,
    runExecutions,
    graph,
    autonomyDiagnostics,
    retrospectiveTrace,
    isLoadingGraph,
    graphError,
    initialTab,
    activeSessionPath,
    onBack,
    onRestartOrchestration,
    isRestartOrchestrationPending,
    onRestartWorkItemWorkflow,
    isRestartWorkItemWorkflowPending,
    onRerunOriginalWorkflow,
    isRerunOriginalWorkflowPending,
    workItemRestartNotice,
    failureReason,
    onAbortRun,
    isAbortRunPending,
    budgetDecision,
    budgetReasonCode,
    budgetEstimatedCostCents,
    budgetRemainingCents,
  } = props;
  const [activeTab, setActiveTab] = useState(initialTab ?? "graph");
  const { activityFilters, setActivityFilters } = useActivityFilter();

  return (
    <div className="space-y-6">
      <WorkflowRunDetailHeader
        run={run}
        workflowId={workflowId}
        connectionState={connectionState}
        activeSessionPath={activeSessionPath}
        onBack={onBack}
        onAbortRun={onAbortRun}
        isAbortRunPending={isAbortRunPending}
        onRestartOrchestration={onRestartOrchestration}
        isRestartOrchestrationPending={isRestartOrchestrationPending}
        onRestartWorkItemWorkflow={onRestartWorkItemWorkflow}
        isRestartWorkItemWorkflowPending={isRestartWorkItemWorkflowPending}
        onRerunOriginalWorkflow={onRerunOriginalWorkflow}
        isRerunOriginalWorkflowPending={isRerunOriginalWorkflowPending}
      />

      <WorkflowRunDiagnosticsStrip
        run={run}
        events={events}
        failureReason={failureReason}
        workItemRestartNotice={workItemRestartNotice}
        telemetryError={telemetryError}
        autonomyDiagnostics={autonomyDiagnostics}
        retrospectiveTrace={retrospectiveTrace}
        budgetDecision={budgetDecision}
        budgetReasonCode={budgetReasonCode}
        budgetEstimatedCostCents={budgetEstimatedCostCents}
        budgetRemainingCents={budgetRemainingCents}
        pendingQuestions={pendingQuestions}
        onSubmitAnswers={onSubmitAnswers}
        isSubmittingAnswers={isSubmittingAnswers}
      />

      <WorkflowRunPhasesBanner phaseMarkers={phaseMarkers} />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="graph">Graph & Steps</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="subagents">Subagents</TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="space-y-6">
          <WorkflowRunGraphTab
            run={run}
            workflowId={workflowId}
            graph={graph}
            isLoadingGraph={isLoadingGraph}
            graphError={graphError}
            stepOutputs={stepOutputs}
            runExecutions={runExecutions}
          />
        </TabsContent>

        <TabsContent value="chat" className="space-y-6">
          <WorkflowRunChatTab
            chatMessages={chatMessages}
            chatEmptyMessage={chatEmptyMessage}
            message={message}
            onMessageChange={onMessageChange}
            onInjectMessage={onInjectMessage}
            isInjectingMessage={isInjectingMessage}
            isInteractive={isInteractive}
          />
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <WorkflowRunEventsTab
            events={events}
            isLoadingTelemetry={isLoadingTelemetry}
            activityFilters={activityFilters}
            onActivityFiltersChange={setActivityFilters}
          />
        </TabsContent>

        <TabsContent value="subagents" className="space-y-6">
          <WorkflowRunSubagentsTab events={events} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
