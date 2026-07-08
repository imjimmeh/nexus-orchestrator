import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ActiveSessionWorkspaceContent } from "./ActiveSessionWorkspaceContent";

vi.mock("@/components/chat/AgentChatPanel", () => ({
  AgentChatPanel: (props: {
    disabled?: boolean;
    messages?: Array<{
      questions?: Array<{ question: string; options: string[] }>;
    }>;
    onSend: () => void;
    sending?: boolean;
  }) => (
    <div>
      {props.messages?.flatMap((message) =>
        (message.questions ?? []).map((question) => (
          <p key={question.question}>{question.question}</p>
        )),
      )}
      <button
        type="button"
        disabled={props.disabled || props.sending}
        onClick={props.onSend}
      >
        Mock Agent Chat Send
      </button>
    </div>
  ),
}));

vi.mock("@/components/orchestration/SubagentExecutionPanel", () => ({
  SubagentExecutionPanel: () => <div>Mock Subagent Execution Panel</div>,
}));

vi.mock("./ActiveSessionWorkspacePanels", () => ({
  TerminalPanel: () => <div>Mock Terminal Panel</div>,
  DiffPanel: () => <div>Mock Diff Panel</div>,
  FileTreePanel: () => <div>Mock File Tree Panel</div>,
}));

function buildProps(
  overrides: Partial<ComponentProps<typeof ActiveSessionWorkspaceContent>> = {},
): ComponentProps<typeof ActiveSessionWorkspaceContent> {
  return {
    isChatSession: true,
    runId: "chat-session-1",
    sessionTitle: "Chat Session",
    backPath: "/sessions",
    connectionState: "connected",
    telemetryError: null,
    controlNotice: null,
    executionTab: "terminal",
    terminalChunks: [],
    chatMessages: [],
    message: "",
    conflictGuidance: "",
    workspaceDiff: "",
    workspaceTree: [],
    workspaceDiffLoading: false,
    workspaceDiffError: null,
    workspaceTreeLoading: false,
    workspaceTreeError: null,
    runTodoList: null,
    runTodoListLoading: false,
    runTodoListError: null,
    runTodoListUpdatePending: false,
    agentTodos: [],
    phaseMarkers: [],
    telemetryEvents: [],
    isBlocked: false,
    mergeConflictReason: null,
    pendingQuestions: null,
    chatSessionState: "RUNNING",
    chatParticipants: [],
    chatParticipantCount: 0,
    chatActiveParticipantCount: 0,
    chatInvitedParticipantCount: 0,
    chatParticipantsLoading: false,
    chatParticipantsError: null,
    chatSessionStateLoading: false,
    chatSessionStateError: null,
    inviteCandidates: [],
    inviteAgentProfile: "",
    inviteRole: "participant",
    invitePending: false,
    inviteError: null,
    inviteDenialReason: null,
    isRunPaused: false,
    isRunTerminal: false,
    pausePending: false,
    resumePending: false,
    abortPending: false,
    injectPending: false,
    submitAnswersPending: false,
    markInProgressPending: false,
    instructResolvePending: false,
    onMessageChange: () => undefined,
    onConflictGuidanceChange: () => undefined,
    onExecutionTabChange: () => undefined,
    onInviteAgentProfileChange: () => undefined,
    onInviteRoleChange: () => undefined,
    onInviteParticipant: () => undefined,
    onPause: () => undefined,
    onResume: () => undefined,
    onAbort: () => undefined,
    onInject: () => undefined,
    onSubmitAnswers: () => undefined,
    onInstructResolve: () => undefined,
    onMarkInProgress: () => undefined,
    onUpdateTodoStatus: () => undefined,
    ...overrides,
  };
}

describe("ActiveSessionWorkspaceContent", () => {
  it("renders control notice feedback", () => {
    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            controlNotice: {
              type: "error",
              title: "Cancellation Failed",
              message: "No active container found for this session.",
            },
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Cancellation Failed")).toBeTruthy();
    expect(
      screen.getByText("No active container found for this session."),
    ).toBeTruthy();
  });

  it("applies info styling and in-progress label", () => {
    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            controlNotice: {
              type: "info",
              title: "Cancellation Requested",
              message: "Waiting for terminal status.",
            },
          })}
        />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.className.includes("bg-sky-50")).toBe(true);
    expect(screen.getByText("In Progress")).toBeTruthy();
  });

  it("applies success styling and label", () => {
    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            controlNotice: {
              type: "success",
              title: "Session Cancelled",
              message: "The session is now cancelled.",
            },
          })}
        />
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.className.includes("bg-emerald-50")).toBe(true);
    expect(screen.getByText("Success")).toBeTruthy();
  });

  it("routes composer sends as question answers while a question is pending", async () => {
    const user = userEvent.setup();
    const onInject = vi.fn();
    const onSubmitAnswers = vi.fn();

    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            message: "Svelte",
            pendingQuestions: [
              { question: "Which framework?", options: ["React", "Vue"] },
            ],
            onInject,
            onSubmitAnswers,
          })}
        />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Mock Agent Chat Send" }),
    );

    expect(onInject).not.toHaveBeenCalled();
    expect(onSubmitAnswers).toHaveBeenCalledWith([
      { questionIndex: 0, selectedOption: null, freeTextAnswer: "Svelte" },
    ]);
  });

  it("disables composer sends while a question answer is submitting", async () => {
    const user = userEvent.setup();
    const onSubmitAnswers = vi.fn();

    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            message: "Svelte",
            pendingQuestions: [
              { question: "Which framework?", options: ["React", "Vue"] },
            ],
            submitAnswersPending: true,
            onSubmitAnswers,
          })}
        />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Mock Agent Chat Send" }),
    );

    expect(onSubmitAnswers).not.toHaveBeenCalled();
  });

  it("does not show the standalone question card when chat has inline questions", () => {
    const pendingQuestions = [
      { question: "Which framework?", options: ["React", "Vue"] },
    ];

    render(
      <MemoryRouter>
        <ActiveSessionWorkspaceContent
          {...buildProps({
            chatMessages: [
              {
                id: "question-message",
                role: "event",
                content: "Which framework?",
                questions: pendingQuestions,
              },
            ],
            pendingQuestions,
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Agent is asking for your input")).toBeNull();
    expect(screen.getByText("Which framework?")).toBeTruthy();
  });
});
