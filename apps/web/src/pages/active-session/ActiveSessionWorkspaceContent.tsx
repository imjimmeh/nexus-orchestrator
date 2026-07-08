import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentTodoPanel } from "@/components/chat/AgentTodoPanel";
import {
  AgentChatPanel,
  type AgentChatMessage,
} from "@/components/chat/AgentChatPanel";
import { QuestionCard } from "@/components/chat/QuestionCard";
import { SubagentExecutionPanel } from "@/components/orchestration/SubagentExecutionPanel";
import { deepEqual } from "@/lib/deep-equal";
import { ChatSessionParticipant, ChatSessionParticipantRole } from "@/lib/api/chat-sessions.types";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";
import { WorkflowRunTodoList, WorkflowRunTodoStatus } from "@/lib/api/workflow-todos.types";
import { WorkflowTelemetryEvent, WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";
import type { TodoItem } from "@nexus/core";
import type { ActiveSessionControlNotice } from "./active-session.workspace.types";
import {
  DiffPanel,
  FileTreePanel,
  TerminalPanel,
} from "./ActiveSessionWorkspacePanels";
import {
  ChatCollaborationSection,
  ConflictResolutionSection,
  ControlButtons,
} from "./ActiveSessionWorkspaceSections";

type ExecutionTabKey = "terminal" | "diff" | "tree";

interface ActiveSessionWorkspaceContentProps {
  isChatSession: boolean;
  runId: string | null;
  sessionTitle: string;
  backPath: string;
  connectionState: string;
  telemetryError: string | null;
  controlNotice: ActiveSessionControlNotice | null;
  executionTab: ExecutionTabKey;
  terminalChunks: string[];
  chatMessages: AgentChatMessage[];
  message: string;
  conflictGuidance: string;
  workspaceDiff: string;
  workspaceTree: WorkflowWorkspaceTreeNode[];
  workspaceDiffLoading: boolean;
  workspaceDiffError: string | null;
  workspaceTreeLoading: boolean;
  workspaceTreeError: string | null;
  runTodoList: WorkflowRunTodoList | null;
  runTodoListLoading: boolean;
  runTodoListError: string | null;
  runTodoListUpdatePending: boolean;
  agentTodos: TodoItem[];
  phaseMarkers: string[];
  telemetryEvents: WorkflowTelemetryEvent[];
  isBlocked: boolean;
  mergeConflictReason: string | null;
  pendingQuestions: UserQuestion[] | null;
  chatSessionState: string | null;
  chatParticipants: ChatSessionParticipant[];
  chatParticipantCount: number;
  chatActiveParticipantCount: number;
  chatInvitedParticipantCount: number;
  chatParticipantsLoading: boolean;
  chatParticipantsError: string | null;
  chatSessionStateLoading: boolean;
  chatSessionStateError: string | null;
  inviteCandidates: Array<{
    name: string;
    tierPreference: string | null;
  }>;
  inviteAgentProfile: string;
  inviteRole: ChatSessionParticipantRole;
  invitePending: boolean;
  inviteError: string | null;
  inviteDenialReason: string | null;
  isRunPaused: boolean;
  isRunTerminal: boolean;
  pausePending: boolean;
  resumePending: boolean;
  abortPending: boolean;
  injectPending: boolean;
  submitAnswersPending: boolean;
  markInProgressPending: boolean;
  instructResolvePending: boolean;
  onMessageChange: (value: string) => void;
  onConflictGuidanceChange: (value: string) => void;
  onExecutionTabChange: (value: ExecutionTabKey) => void;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ChatSessionParticipantRole) => void;
  onInviteParticipant: () => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onInject: (attachmentIds?: string[]) => void;
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
  onInstructResolve: () => void;
  onMarkInProgress: () => void;
  onUpdateTodoStatus: (todoId: string, status: WorkflowRunTodoStatus) => void;
}

interface ControlNoticePresentation {
  className?: string;
  label: string | null;
  dotClassName?: string;
}

function resolveControlNoticePresentation(
  notice: ActiveSessionControlNotice,
): ControlNoticePresentation {
  if (notice.type === "success") {
    return {
      className:
        "border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100",
      label: "Success",
      dotClassName: "bg-emerald-600",
    };
  }

  if (notice.type === "info") {
    return {
      className:
        "border-sky-500/40 bg-sky-50 text-sky-900 dark:bg-sky-950/20 dark:text-sky-100",
      label: "In Progress",
      dotClassName: "bg-sky-600",
    };
  }

  return {
    className: undefined,
    label: null,
    dotClassName: undefined,
  };
}

function ControlNoticeBanner({
  notice,
}: {
  notice: ActiveSessionControlNotice | null;
}) {
  if (!notice) {
    return null;
  }

  const presentation = resolveControlNoticePresentation(notice);

  return (
    <Alert
      variant={notice.type === "error" ? "destructive" : "default"}
      className={presentation.className}
    >
      {presentation.label && (
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              presentation.dotClassName,
            )}
          />
          {presentation.label}
        </div>
      )}
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}

function matchQuestionOption(
  question: UserQuestion,
  responseText: string,
): string | null {
  const normalized = responseText.trim().toLowerCase();
  return (
    question.options.find(
      (option) => option.trim().toLowerCase() === normalized,
    ) ?? null
  );
}

function buildAnswerFromComposer(
  questions: UserQuestion[] | null,
  message: string,
): QuestionAnswer[] | null {
  const responseText = message.trim();
  const firstQuestion = questions?.[0];
  if (!firstQuestion || responseText.length === 0) {
    return null;
  }

  const selectedOption = matchQuestionOption(firstQuestion, responseText);
  return [
    {
      questionIndex: 0,
      selectedOption,
      freeTextAnswer: selectedOption ? null : responseText,
    },
  ];
}

function hasInlineQuestionMessage(
  messages: AgentChatMessage[],
  questions: UserQuestion[] | null,
): boolean {
  if (!questions) {
    return false;
  }

  return messages.some((message) => deepEqual(message.questions, questions));
}

export function ActiveSessionWorkspaceContent(
  props: Readonly<ActiveSessionWorkspaceContentProps>,
) {
  const navigate = useNavigate();
  const hasSessionTarget = Boolean(props.runId);
  const shouldShowQuestionCard =
    props.pendingQuestions &&
    props.pendingQuestions.length > 0 &&
    !hasInlineQuestionMessage(props.chatMessages, props.pendingQuestions);
  const handleChatSend = (attachmentIds?: string[]) => {
    const answer = buildAnswerFromComposer(
      props.pendingQuestions,
      props.message,
    );
    if (answer) {
      props.onSubmitAnswers(answer);
      return;
    }

    if (!props.pendingQuestions || props.pendingQuestions.length === 0) {
      props.onInject(attachmentIds);
    }
  };
  const onExecutionTabValueChange = (value: string) => {
    props.onExecutionTabChange(value as ExecutionTabKey);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Active Session Workspace
          </h2>
          <p className="text-sm text-muted-foreground">{props.sessionTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{props.connectionState}</Badge>
          <Button variant="outline" onClick={() => navigate(props.backPath)}>
            Back
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <ControlButtons
            hasRunId={hasSessionTarget}
            supportsPauseResume={!props.isChatSession}
            isRunPaused={props.isRunPaused}
            isRunTerminal={props.isRunTerminal}
            pausePending={props.pausePending}
            resumePending={props.resumePending}
            abortPending={props.abortPending}
            onPause={props.onPause}
            onResume={props.onResume}
            onAbort={props.onAbort}
          />
        </CardContent>
      </Card>

      <ControlNoticeBanner notice={props.controlNotice} />

      <Card>
        <CardHeader>
          <CardTitle>Run Phases</CardTitle>
        </CardHeader>
        <CardContent>
          {props.phaseMarkers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No phase markers detected yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {props.phaseMarkers.map((phase) => (
                <Badge key={phase} variant="secondary">
                  {phase}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {props.telemetryError && (
        <Card>
          <CardContent className="pt-4 text-sm text-destructive">
            {props.telemetryError}
          </CardContent>
        </Card>
      )}

      {shouldShowQuestionCard && (
        <QuestionCard
          questions={props.pendingQuestions}
          onSubmit={props.onSubmitAnswers}
          submitting={props.submitAnswersPending}
        />
      )}

      <ChatCollaborationSection
        visible={props.isChatSession}
        chatSessionState={props.chatSessionState}
        chatParticipants={props.chatParticipants}
        chatParticipantCount={props.chatParticipantCount}
        chatActiveParticipantCount={props.chatActiveParticipantCount}
        chatInvitedParticipantCount={props.chatInvitedParticipantCount}
        chatParticipantsLoading={props.chatParticipantsLoading}
        chatParticipantsError={props.chatParticipantsError}
        chatSessionStateLoading={props.chatSessionStateLoading}
        chatSessionStateError={props.chatSessionStateError}
        inviteCandidates={props.inviteCandidates}
        inviteAgentProfile={props.inviteAgentProfile}
        inviteRole={props.inviteRole}
        invitePending={props.invitePending}
        inviteError={props.inviteError}
        inviteDenialReason={props.inviteDenialReason}
        onInviteAgentProfileChange={props.onInviteAgentProfileChange}
        onInviteRoleChange={props.onInviteRoleChange}
        onInviteParticipant={props.onInviteParticipant}
      />

      <AgentTodoPanel todos={props.agentTodos} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[68vh] min-w-0 rounded-lg border">
          <AgentChatPanel
            title="Cognitive Stream"
            messages={props.chatMessages}
            input={props.message}
            inputPlaceholder="Inject guidance to the running agent"
            onInputChange={props.onMessageChange}
            onSend={handleChatSend}
            sendLabel="Send"
            sending={props.injectPending || props.submitAnswersPending}
            disabled={!hasSessionTarget}
            emptyMessage="No chat or events yet in this session."
            agentLabel="Agent"
            activeQuestions={props.pendingQuestions ?? undefined}
            answeringQuestions={props.submitAnswersPending}
            onAnswerQuestions={props.onSubmitAnswers}
          />
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Execution</CardTitle>
            <Tabs
              value={props.executionTab}
              onValueChange={onExecutionTabValueChange}
            >
              <TabsList>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
                <TabsTrigger value="diff">Git Diff</TabsTrigger>
                <TabsTrigger value="tree">File Tree</TabsTrigger>
              </TabsList>
              <TabsContent value="terminal">
                <TerminalPanel chunks={props.terminalChunks} />
              </TabsContent>
              <TabsContent value="diff">
                <DiffPanel
                  diff={props.workspaceDiff}
                  isLoading={props.workspaceDiffLoading}
                  error={props.workspaceDiffError}
                />
              </TabsContent>
              <TabsContent value="tree">
                <FileTreePanel
                  nodes={props.workspaceTree}
                  isLoading={props.workspaceTreeLoading}
                  error={props.workspaceTreeError}
                />
              </TabsContent>
            </Tabs>
          </CardHeader>
        </Card>
      </div>

      <ConflictResolutionSection
        visible={props.isBlocked}
        reason={props.mergeConflictReason}
        guidance={props.conflictGuidance}
        hasRunId={hasSessionTarget}
        markInProgressPending={props.markInProgressPending}
        instructResolvePending={props.instructResolvePending}
        onGuidanceChange={props.onConflictGuidanceChange}
        onInstructResolve={props.onInstructResolve}
        onMarkInProgress={props.onMarkInProgress}
      />

      <SubagentExecutionPanel events={props.telemetryEvents} />
    </div>
  );
}
