import { describe, expect, it } from "vitest";
import { toSessionChatMessages } from "./active-session.chat-builder";

describe("active-session chat builder", () => {
  it("merges tool start, update, and end events into one message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "tool_execution_start",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          args: { query: "session UX" },
        },
      },
      {
        event_type: "tool_execution_update",
        timestamp: "2026-04-24T10:00:02.000Z",
        payload: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          partialResult: { progress: 50 },
        },
      },
      {
        event_type: "tool_execution_end",
        timestamp: "2026-04-24T10:00:04.000Z",
        payload: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          result: { matches: 12 },
          isError: false,
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "agent",
      label: "Tool",
      category: "tool",
      content: "search_docs · ✓",
      collapsedByDefault: false,
    });
    expect(messages[0]?.metadata?.type).toBe("tool_call");
    expect(messages[0]?.metadata).toMatchObject({
      toolName: "search_docs",
      callId: "tool-1",
      status: "finished",
      argsObj: { query: "session UX" },
      partialResults: [{ progress: 50 }],
      resultObj: { matches: 12 },
      isError: false,
      summary: "search_docs · ✓",
    });
  });

  it("labels stringified JSON tool args without rewriting raw args", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "tool_execution_end",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          toolName: "set_job_output",
          toolCallId: "tool-1",
          args: { data: '{"summary":"done"}' },
          result: { ok: false },
          isError: true,
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.metadata?.type).toBe("tool_call");
    expect(messages[0]?.metadata).toMatchObject({
      toolName: "set_job_output",
      callId: "tool-1",
      status: "finished",
      resultObj: { ok: false },
      isError: true,
      summary: "set_job_output · ✗",
    });
    expect(
      (messages[0]?.metadata as { argsObj: unknown }).argsObj,
    ).toBeUndefined();
  });

  it("renders thinking telemetry blocks as collapsed Thought messages by default", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          type: "thinking_end",
          content: "analyzing request",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-04-24T10:00:01.000Z",
        payload: {
          type: "text_delta",
          delta: "Done.",
        },
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Thought",
      category: "thought",
      content: "analyzing request",
      collapsedByDefault: true,
    });
    expect(messages[1]).toMatchObject({ role: "agent", content: "Done." });
  });

  it("hides thinking telemetry blocks when hideThinking is enabled", () => {
    const messages = toSessionChatMessages(
      [
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: {
            type: "thinking_end",
            content: "analyzing request",
          },
        },
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:01.000Z",
          payload: {
            type: "text_delta",
            delta: "Done.",
          },
        },
      ],
      { hideThinking: true },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "agent", content: "Done." });
  });

  it("renders orchestration skip marker from turn_end output as a system message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "turn_end",
        timestamp: "2026-04-08T14:44:48.000Z",
        payload: {
          stepId: "skip_cycle",
          output: {
            stdout: "skip_project_orchestration_cycle_not_orchestrating",
            stderr: "",
            exitCode: 0,
          },
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "System",
      content:
        "Orchestration cycle skipped because project orchestration is not currently in orchestrating state.",
    });
  });

  it("renders status mismatch turn_end output as a system message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "turn_end",
        timestamp: "2026-04-08T14:44:47.000Z",
        payload: {
          stepId: "check_orchestration_active",
          output: {
            reason: "status_mismatch",
            required_status: "orchestrating",
            actual_status: "completed",
          },
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "System",
      content:
        "Orchestration cycle skipped: required status orchestrating, current status completed.",
    });
  });

  it("renders container_removing as a container lifecycle message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "container_removing",
        timestamp: "2026-04-13T20:10:00.000Z",
        payload: { jobId: "job-1", stepId: "step-1", containerId: "c-1" },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Container",
      category: "container",
      content: "Removing container",
    });
  });

  it("renders container_removed as a container lifecycle message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "container_removed",
        timestamp: "2026-04-13T20:10:01.000Z",
        payload: { jobId: "job-1", stepId: "step-1", containerId: "c-1" },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Container",
      category: "container",
      content: "Container removed",
    });
  });

  it("renders execution.reaped as a container lifecycle message with failure reason", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "execution.reaped",
        timestamp: "2026-04-13T20:10:02.000Z",
        payload: {
          failure_reason: "container_lost",
          error_message: "Container was lost during execution",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Container",
      category: "container",
      content: expect.stringContaining("container_lost"),
    });
  });

  it("renders workflow.retry_scheduled as a system lifecycle message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "workflow.retry_scheduled",
        timestamp: "2026-04-13T20:11:00.000Z",
        payload: {
          reason: "rate_limit",
          jobId: "job-1",
          retryAfterMs: 5000,
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Workflow",
      category: "system",
      content: expect.stringContaining("retry"),
    });
  });

  it("renders session_cancelled as a lifecycle message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "session_cancelled",
        timestamp: "2026-04-13T20:10:00.000Z",
        payload: {
          chatSessionId: "chat-1",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Session",
      content: "Session cancelled",
    });
  });

  it("renders workflow.run.started as a lifecycle system message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "workflow.run.started",
        timestamp: "2026-04-13T20:10:01.000Z",
        payload: {
          workflowId: "workflow-1",
          workflowRunId: "run-1",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Workflow",
      content: expect.stringContaining("Workflow run started"),
    });
  });

  it("renders job_start as a lifecycle message with job id", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "job_start",
        timestamp: "2026-04-13T20:10:02.000Z",
        payload: {
          jobId: "job-123",
          workflowRunId: "run-1",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Workflow",
      content: expect.stringContaining("job-123"),
    });
  });

  it("renders invoke_workflow.child_started with child run and workflow IDs", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "invoke_workflow.child_started",
        timestamp: "2026-04-13T20:10:03.000Z",
        payload: {
          childRunId: "run-child-1",
          invokedWorkflowId: "workflow-child-1",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Workflow",
      content: expect.stringContaining("run-child-1"),
    });
    expect(messages[0].content).toContain("workflow-child-1");
  });

  it("renders ask_user_questions tool starts as structured question messages", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "tool_execution_start",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          toolName: "ask_user_questions",
          toolCallId: "tool-question-1",
          args: {
            questions: [
              {
                question: "Which framework?",
                options: ["React", "Vue"],
              },
            ],
          },
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Questions from Agent",
      category: "question",
      questions: [{ question: "Which framework?", options: ["React", "Vue"] }],
    });
  });

  it("does not duplicate the same question from tool start and posed events", () => {
    const question = {
      question: "Which framework?",
      options: ["React", "Vue"],
    };

    const messages = toSessionChatMessages([
      {
        event_type: "tool_execution_start",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          toolName: "ask_user_questions",
          toolCallId: "tool-question-1",
          args: { questions: [question] },
        },
      },
      {
        event_type: "user_questions_posed",
        timestamp: "2026-04-24T10:00:01.000Z",
        payload: { questions: [question] },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      label: "Questions from Agent",
      questions: [question],
    });
  });

  describe("turn_end deduplication against streaming text deltas", () => {
    it("does not create a second agent bubble when text_delta events already built the response", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: { type: "text_delta", delta: "Hello " },
        },
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:01.000Z",
          payload: { type: "text_delta", delta: "world" },
        },
        {
          event_type: "turn_end",
          timestamp: "2026-04-24T10:00:02.000Z",
          payload: {
            output: { response: "Hello world" },
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "agent",
        content: "Hello world",
        category: "agent",
      });
    });

    it("does not create a second agent bubble when text_delta ends with text_end before turn_end", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: { type: "text_delta", delta: "Hello world" },
        },
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:01.000Z",
          payload: { type: "text_end", delta: "" },
        },
        {
          event_type: "turn_end",
          timestamp: "2026-04-24T10:00:02.000Z",
          payload: {
            output: { response: "Hello world" },
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "agent",
        content: "Hello world",
        category: "agent",
      });
    });

    it("still creates an agent bubble from turn_end when no prior text_delta events exist", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "turn_end",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: {
            output: { response: "Hello world" },
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "agent",
        content: "Hello world",
        category: "agent",
      });
    });

    it("updates the streamed message content to the authoritative turn_end response", () => {
      // Simulates a case where streaming produced partial text, turn_end provides the
      // final authoritative version (e.g. trimmed or normalized by the server)
      const messages = toSessionChatMessages([
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: { type: "text_delta", delta: "Hello world  " },
        },
        {
          event_type: "turn_end",
          timestamp: "2026-04-24T10:00:01.000Z",
          payload: {
            output: { response: "Hello world" },
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello world");
    });

    it("resets stream tracking on user_message so turn_end after a new user message creates a new bubble", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "agent_telemetry",
          timestamp: "2026-04-24T10:00:00.000Z",
          payload: { type: "text_delta", delta: "First response" },
        },
        {
          event_type: "user_message",
          timestamp: "2026-04-24T10:00:01.000Z",
          payload: { message: "Follow-up question" },
        },
        {
          event_type: "turn_end",
          timestamp: "2026-04-24T10:00:02.000Z",
          payload: {
            output: { response: "Second response" },
          },
        },
      ]);

      // user_message + first-agent-delta + turn_end (second agent bubble)
      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({
        role: "agent",
        content: "First response",
      });
      expect(messages[1]).toMatchObject({
        role: "user",
        content: "Follow-up question",
      });
      expect(messages[2]).toMatchObject({
        role: "agent",
        content: "Second response",
      });
    });
  });

  describe("command event wiring", () => {
    it("merges command_started, command_output, and command_finished into one command_card item", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "command_started",
          timestamp: "2026-06-23T10:00:00.000Z",
          payload: { stepId: "run_gate", command: "npm test" },
        },
        {
          event_type: "command_output",
          timestamp: "2026-06-23T10:00:01.000Z",
          payload: {
            stepId: "run_gate",
            stream: "stdout",
            chunk: "PASS\n",
            seq: 0,
          },
        },
        {
          event_type: "command_finished",
          timestamp: "2026-06-23T10:00:02.000Z",
          payload: {
            stepId: "run_gate",
            exitCode: 0,
            timedOut: false,
            ok: true,
            outputTail: "PASS\n",
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        category: "command",
      });
      const meta = messages[0].metadata as {
        type: "command_card";
        model: { command: string; output: string };
      };
      expect(meta.type).toBe("command_card");
      expect(meta.model.command).toBe("npm test");
      expect(meta.model.output).toContain("PASS");
    });
  });
});
