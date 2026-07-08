import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ExecutionSummary, WorkflowRun } from "@/lib/api/workflows.types";
import { WorkflowRunDetailContent } from "./WorkflowRunDetailContent";

vi.mock("@/components/workflow/WorkflowVisualizer", () => ({
  WorkflowVisualizer: () => <div>Workflow visualizer mock</div>,
}));

Object.defineProperty(Element.prototype, "scrollIntoView", {
  value: vi.fn(),
  writable: true,
});

function baseRun(): WorkflowRun {
  return {
    id: "run-1",
    workflow_id: "wf-1",
    status: "RUNNING",
    trigger_event: "work_item_in_review",
    started_at: null,
    completed_at: null,
    created_at: "2026-04-07T10:00:00.000Z",
    updated_at: "2026-04-07T10:00:00.000Z",
    state_variables: {},
  } as WorkflowRun;
}

describe("WorkflowRunDetailContent", () => {
  it("renders direct session workspace navigation when available", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          activeSessionPath="/projects/p1/runs/run-1/active-session"
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Open Session Workspace" }),
    ).toBeTruthy();
  });

  it("wires chat input updates and send action", () => {
    const onMessageChange = vi.fn();
    const onInjectMessage = vi.fn();

    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message="hello"
          onMessageChange={onMessageChange}
          onInjectMessage={onInjectMessage}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          initialTab="chat"
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.change(
      screen.getByPlaceholderText("Inject guidance to the running agent"),
      {
        target: { value: "updated" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onMessageChange).toHaveBeenCalledWith("updated");
    expect(onInjectMessage).toHaveBeenCalledTimes(1);
  });

  it("renders question card when run has pending questions", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[
            {
              question: "Should I squash commits?",
              options: ["yes", "no"],
            },
          ]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Agent is asking for your input")).toBeTruthy();
    expect(screen.getByText("Should I squash commits?")).toBeTruthy();
  });

  it("renders graph and steps tab by default", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={["Planning"]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[{ stepId: "step-1", output: { result: "ok" } }]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "Graph & Steps" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Subagents" })).toBeTruthy();
    expect(screen.getByText("Planning")).toBeTruthy();
    expect(screen.getByText("step-1")).toBeTruthy();
  });

  it("renders a Models used card with a badge per resolved execution", () => {
    const execution: ExecutionSummary = {
      id: "exec-1",
      kind: "workflow_step",
      state: "completed",
      provider: "anthropic",
      model: "claude-opus-4-8",
      harnessId: "claude-code",
      agentProfileName: "ceo",
      providerSource: "agent_profile",
      workflowRunId: "run-1",
      chatSessionId: null,
      contextId: null,
      createdAt: "2026-04-07T10:00:00.000Z",
      terminalAt: null,
    };

    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[execution]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Models used")).toBeTruthy();
    expect(screen.getByText("anthropic · claude-opus-4-8")).toBeTruthy();
  });

  it("renders an empty-state message when no executions are recorded", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Models used")).toBeTruthy();
    expect(screen.getByText("No executions recorded yet.")).toBeTruthy();
  });

  it("renders retrospective trace outcome visibility when available", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          retrospectiveTrace={{
            workflowRunId: "run-1",
            findingsTotal: 2,
            outcomes: { routed: 1, rejected_schema: 1 },
            findings: [
              {
                index: 0,
                originalRunId: "original-run-1",
                outcome: "routed",
                reasonCode: null,
                candidateId: "candidate-1",
                skillProposalId: null,
              },
              {
                index: 1,
                originalRunId: "original-run-1",
                outcome: "rejected_schema",
                reasonCode: "schema_invalid",
                candidateId: null,
                skillProposalId: null,
              },
            ],
          }}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Retrospective learning trace")).toBeTruthy();
    expect(screen.getByText("2 findings observed")).toBeTruthy();
    expect(screen.getByText("routed: 1")).toBeTruthy();
    expect(screen.getByText("rejected_schema: 1")).toBeTruthy();
    expect(screen.getByText("#1 rejected_schema"));
    expect(screen.getByText("Reason: schema_invalid")).toBeTruthy();
  });

  it("shows the selected run context above the graph on the run detail page", () => {
    render(
      <MemoryRouter initialEntries={["/workflows/workflow-1/runs/run-1"]}>
        <WorkflowRunDetailContent
          run={baseRun()}
          workflowId="workflow-1"
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Currently executing run")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "run-1" }).getAttribute("href"),
    ).toBe("/workflows/workflow-1/runs/run-1");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Workflow visualizer mock")).toBeTruthy();
  });

  it("renders unified activity feed entries in the events tab panel", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[
            {
              event_type: "step_start",
              timestamp: "2026-04-07T10:01:00.000Z",
              payload: {},
            },
            {
              event_type: "tool_execution_start",
              timestamp: "2026-04-07T10:02:00.000Z",
              payload: { toolName: "test_tool" },
            },
          ]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          initialTab="events"
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
    expect(screen.getByText("step_start")).toBeTruthy();
    expect(screen.getByText("tool_execution_start")).toBeTruthy();
  });

  it("hydrates activity filters from URL query params", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/workflows/wf-1/runs/run-1?evq=test_tool&evwf=0&evt=tool",
        ]}
      >
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[
            {
              event_type: "step_start",
              timestamp: "2026-04-07T10:01:00.000Z",
              payload: {},
            },
            {
              event_type: "tool_execution_start",
              timestamp: "2026-04-07T10:02:00.000Z",
              payload: { toolName: "test_tool" },
            },
          ]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          initialTab="events"
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByDisplayValue("test_tool")).toBeTruthy();
    expect(screen.queryByText("step_start")).toBeNull();
    expect(screen.getByText("tool_execution_start")).toBeTruthy();
  });

  it("shows a rate-limit retry card from persisted workflow auto-retry metadata", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={{
            ...baseRun(),
            state_variables: {
              _internal: {
                auto_retry: {
                  transition_to_ready_to_merge: {
                    attempt: 1,
                    last_failure: {
                      reasonCode: "provider_rate_limit_429",
                      nextRetryAt: "2026-04-07T10:10:00.000Z",
                      resetAt: "2026-04-07T10:30:00.000Z",
                      providerTier: "free",
                      usageLimit: {
                        used: 10_000,
                        limit: 10_000,
                        unit: "tokens",
                      },
                    },
                  },
                },
              },
            },
          }}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Provider rate limit retry scheduled"),
    ).toBeTruthy();
    expect(screen.getByText("Attempt 1")).toBeTruthy();
    expect(screen.getByText("Tier: free")).toBeTruthy();
    expect(screen.getByText("Usage: 10000/10000 tokens")).toBeTruthy();
  });

  it("suppresses the generic failure card when a failed run has rate-limit retry metadata", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={{
            ...baseRun(),
            status: "FAILED",
            state_variables: {
              _internal: {
                auto_retry: {
                  reasonCode: "provider_rate_limit_429",
                  nextRetryAt: "2026-04-07T10:10:00.000Z",
                },
              },
            },
          }}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          failureReason="Provider returned HTTP 429"
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Provider rate limit retry scheduled"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Failure reason: Provider returned HTTP 429"),
    ).toBeNull();
  });

  it("does not show stale rate-limit retry metadata after a newer non-rate failure", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={baseRun()}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[
            {
              event_type: "workflow_retry_scheduled",
              timestamp: "2026-04-07T10:01:00.000Z",
              payload: {
                retryMetadata: {
                  reasonCode: "provider_rate_limit_429",
                  nextRetryAt: "2026-04-07T10:10:00.000Z",
                  attempt: 1,
                  maxAttempts: 3,
                },
              },
            },
            {
              event_type: "workflow_failed",
              timestamp: "2026-04-07T10:02:00.000Z",
              payload: {
                failureClassification: {
                  reasonCode: "agent_process_failed",
                },
              },
            },
          ]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("Provider rate limit retry scheduled"),
    ).toBeNull();
  });

  it("does not prioritize stale state rate-limit metadata over a newer non-rate failure", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={{
            ...baseRun(),
            state_variables: {
              _internal: {
                auto_retry: {
                  reasonCode: "provider_rate_limit_429",
                  nextRetryAt: "2026-04-07T10:10:00.000Z",
                },
              },
            },
          }}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[
            {
              event_type: "workflow_failed",
              timestamp: "2026-04-07T10:02:00.000Z",
              payload: {
                failureClassification: {
                  retryCategory: "manual_recovery_required",
                },
              },
            },
          ]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("Provider rate limit retry scheduled"),
    ).toBeNull();
  });

  it("clears persisted rate-limit metadata after a newer audit failure reason", () => {
    render(
      <MemoryRouter>
        <WorkflowRunDetailContent
          run={{
            ...baseRun(),
            state_variables: {
              _internal: {
                auto_retry: {
                  transition_to_ready_to_merge: {
                    attempt: 1,
                    last_failure: {
                      reasonCode: "provider_rate_limit_429",
                      nextRetryAt: "2026-04-07T10:10:00.000Z",
                    },
                  },
                },
              },
            },
          }}
          connectionState="connected"
          telemetryError={null}
          phaseMarkers={[]}
          events={[
            {
              event_type: "workflow.failed",
              timestamp: "2026-04-07T10:02:00.000Z",
              payload: {
                reason: "Agent process exited with code 1",
              },
            },
          ]}
          isLoadingTelemetry={false}
          chatMessages={[]}
          chatEmptyMessage="No chat yet"
          message=""
          onMessageChange={() => undefined}
          onInjectMessage={() => undefined}
          isInjectingMessage={false}
          pendingQuestions={[]}
          onSubmitAnswers={() => undefined}
          isSubmittingAnswers={false}
          isInteractive
          stepOutputs={[]}
          runExecutions={[]}
          onBack={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("Provider rate limit retry scheduled"),
    ).toBeNull();
  });
});
