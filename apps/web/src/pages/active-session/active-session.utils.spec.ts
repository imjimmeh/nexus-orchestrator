import { describe, expect, it } from "vitest";
import {
  buildConflictResolutionInstruction,
  getBashOutputChunks,
  getMergeConflictReason,
  isWorkflowRunPaused,
  getPendingQuestions,
  toSessionChatMessages,
  toCognitiveBlocks,
} from "./active-session.utils";

describe("active-session utils", () => {
  it("maps telemetry events into cognitive blocks", () => {
    const blocks = toCognitiveBlocks([
      {
        event_type: "user_message",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { message: "Please retry tests" },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: { type: "text_delta", delta: "Running tests now" },
      },
      {
        event_type: "tool_execution_start",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: { toolName: "bash" },
      },
    ]);

    expect(blocks.map((block) => block.type)).toEqual([
      "user",
      "agent",
      "tool",
    ]);
    expect(blocks[2]?.body).toContain("bash");
  });

  it("maps reasoning telemetry as thought blocks", () => {
    const blocks = toCognitiveBlocks([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { type: "reasoning_delta", delta: "Analyzing options" },
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "thought",
      body: "Analyzing options",
    });
  });

  it("extracts bash output chunks preserving order", () => {
    const chunks = getBashOutputChunks([
      {
        event_type: "bash_output",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { chunk: "line 1\n" },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: { type: "text_delta", delta: "hello" },
      },
      {
        event_type: "bash_output",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: { chunk: "line 2\n" },
      },
    ]);

    expect(chunks).toEqual(["line 1\n", "line 2\n"]);
  });

  it("marks workflow as paused when latest control action is pause", () => {
    const paused = isWorkflowRunPaused([
      {
        event_type: "workflow_control",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { action: "resume" },
      },
      {
        event_type: "workflow_control",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: { action: "pause" },
      },
    ]);

    expect(paused).toBe(true);
  });

  it("marks workflow as active when latest control action is resume", () => {
    const paused = isWorkflowRunPaused([
      {
        event_type: "workflow_control",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { action: "pause" },
      },
      {
        event_type: "workflow_control",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: { action: "resume" },
      },
    ]);

    expect(paused).toBe(false);
  });

  it("extracts merge conflict reason from work item metadata", () => {
    const reason = getMergeConflictReason({
      metadata: {
        lifecycle: {
          merge: {
            status: "failed",
            reason: "CONFLICT (content): Merge conflict in src/auth/login.ts",
          },
        },
      },
    } as never);

    expect(reason).toBe(
      "CONFLICT (content): Merge conflict in src/auth/login.ts",
    );
  });

  it("returns null merge conflict reason for missing metadata", () => {
    expect(getMergeConflictReason(null)).toBeNull();
    expect(getMergeConflictReason({ metadata: null } as never)).toBeNull();
    expect(getMergeConflictReason({ metadata: {} } as never)).toBeNull();
  });

  it("builds a conflict instruction with reason and guidance", () => {
    const instruction = buildConflictResolutionInstruction({
      workItemTitle: "Fix login redirect regression",
      mergeReason: "merge conflict in src/router.ts",
      userGuidance: "Prefer main branch route guards.",
    });

    expect(instruction).toContain("Fix login redirect regression");
    expect(instruction).toContain("merge conflict in src/router.ts");
    expect(instruction).toContain("Prefer main branch route guards.");
    expect(instruction).toContain("summarize the files changed");
  });

  it("maps events into a unified chat timeline with tool entries", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "user_message",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { message: "Run tests" },
      },
      {
        event_type: "tool_execution_start",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          toolName: "runTests",
          args: {
            files: [
              "apps/web/src/pages/active-session/active-session.utils.spec.ts",
            ],
          },
        },
      },
      {
        event_type: "tool_execution_end",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          toolName: "runTests",
          result: { ok: true, passed: 8 },
        },
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Run tests" });
    expect(messages[1]).toMatchObject({
      role: "agent",
      label: "Tool",
      content: "runTests · ✓",
    });
    expect(messages[1]?.metadata?.type).toBe("tool_call");
    expect(messages[1]?.metadata).toMatchObject({
      toolName: "runTests",
      status: "finished",
      argsObj: {
        files: [
          "apps/web/src/pages/active-session/active-session.utils.spec.ts",
        ],
      },
      resultObj: { ok: true, passed: 8 },
      isError: false,
      summary: "runTests · ✓",
    });
  });

  it("prepends initial user message when timeline has no user_message event", () => {
    const messages = toSessionChatMessages(
      [
        {
          event_type: "agent_telemetry",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            type: "text_delta",
            delta: "Working on it.",
          },
        },
      ],
      {
        initialUserMessage: "Implement the API endpoint and add tests.",
      },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "Implement the API endpoint and add tests.",
    });
    expect(messages[1]).toMatchObject({
      role: "agent",
      content: "Working on it.",
    });
  });

  it("does not duplicate initial user message when it already exists in events", () => {
    const messages = toSessionChatMessages(
      [
        {
          event_type: "user_message",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            message: "Implement the API endpoint and add tests.",
          },
        },
      ],
      {
        initialUserMessage: "Implement the API endpoint and add tests.",
      },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "Implement the API endpoint and add tests.",
    });
  });

  it("merges streamed agent text chunks into one message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          type: "text_delta",
          messageId: "msg-1",
          delta: "Hello ",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          type: "text_delta",
          messageId: "msg-1",
          delta: "world",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          type: "text_end",
          messageId: "msg-1",
          content: "!",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "agent",
      content: "Hello world!",
    });
  });

  it("uses agent profile fields for streamed agent labels", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          type: "text_delta",
          messageId: "msg-1",
          delta: "Working on it",
          agentProfileName: "orchestrator",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "agent",
      label: "orchestrator",
      content: "Working on it",
    });
  });

  it("uses agent profile fields for turn_end response labels", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "turn_end",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          agent_profile: "reviewer_agent",
          output: {
            response: "Review complete.",
          },
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "agent",
      label: "reviewer_agent",
      content: "Review complete.",
    });
  });

  it("supports message_delta/message_end streaming variants", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          type: "message_delta",
          messageId: "msg-2",
          text: "Part 1 ",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          type: "message_end",
          messageId: "msg-2",
          content: "Part 2",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "agent",
      content: "Part 1 Part 2",
    });
  });

  it("merges streamed thought chunks into one collapsible thought message", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          type: "reasoning_delta",
          messageId: "reason-1",
          delta: "Analyzing ",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          type: "reasoning_delta",
          messageId: "reason-1",
          delta: "trade-offs",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          type: "reasoning_end",
          messageId: "reason-1",
          content: ".",
        },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Thought",
      category: "thought",
      content: "Analyzing trade-offs.",
      collapsedByDefault: true,
    });
  });

  it("includes lifecycle process events in chat timeline", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "step_start",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: { stepId: "implement" },
      },
      {
        event_type: "container_starting",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: { stepId: "implement" },
      },
      {
        event_type: "container_started",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: { containerId: "abc123" },
      },
      {
        event_type: "agent_runtime_ready",
        timestamp: "2026-03-25T00:00:03.000Z",
        payload: { stepId: "implement" },
      },
      {
        event_type: "container_stopped",
        timestamp: "2026-03-25T00:00:04.000Z",
        payload: { exitCode: 0 },
      },
      {
        event_type: "container_removed",
        timestamp: "2026-03-25T00:00:05.000Z",
        payload: { containerId: "abc123" },
      },
    ]);

    expect(messages).toHaveLength(6);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Session",
      content: "Session step implement started",
    });
    expect(messages[1]).toMatchObject({
      role: "event",
      label: "Container",
      content: "Container is starting for implement",
    });
    expect(messages[2]).toMatchObject({
      role: "event",
      label: "Container",
      content: "Container started",
    });
    expect(messages[3]).toMatchObject({
      role: "event",
      label: "Agent Runtime",
      content: "Agent runtime connected for implement",
    });
    expect(messages[4]).toMatchObject({
      role: "event",
      label: "Container",
      content: "Container stopped (exit code 0)",
    });
    expect(messages[5]).toMatchObject({
      role: "event",
      label: "Container",
      content: "Container removed",
    });
  });

  it("renders outbound agent kickoff prompt events in chat timeline", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_prompt_sent",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          stepId: "review",
          source: "workflow_step",
          message: "Review the implementation and submit the QA decision.",
        },
      },
      {
        event_type: "agent_telemetry",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          type: "text_delta",
          delta: "I'll review the implementation now.",
        },
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      label: "You",
      content: "Review the implementation and submit the QA decision.",
    });
    expect(messages[1]).toMatchObject({
      role: "agent",
      content: "I'll review the implementation now.",
    });
  });

  it("renders agent mesh lifecycle events in chat timeline", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "agent_mention_requested",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          target_profile: "reviewer_agent",
          thread_id: "thread-1",
        },
      },
      {
        event_type: "agent_mention_timeout",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          thread_id: "thread-1",
        },
      },
      {
        event_type: "agent_thread_resolved",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          thread_id: "thread-1",
          resolution_note: "Applied the agreed implementation details.",
        },
      },
      {
        event_type: "agent_mention_denied",
        timestamp: "2026-03-25T00:00:03.000Z",
        payload: {
          thread_id: "thread-2",
          reason: "Denied by orchestration policy.",
        },
      },
    ]);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Agent Mesh",
      content: "Requested assistance from reviewer_agent (thread: thread-1)",
    });
    expect(messages[1]).toMatchObject({
      role: "event",
      label: "Agent Mesh",
    });
    expect(messages[1]?.content).toContain("timed out");
    expect(messages[2]).toMatchObject({
      role: "event",
      label: "Agent Mesh",
    });
    expect(messages[2]?.content).toContain(
      "Applied the agreed implementation details.",
    );
    expect(messages[3]).toMatchObject({
      role: "event",
      label: "Agent Mesh",
    });
    expect(messages[3]?.content).toContain("Denied by orchestration policy.");
  });

  it("renders war-room lifecycle events in chat timeline", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "war_room_opened",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          session_id: "war-room-1",
        },
      },
      {
        event_type: "war_room_blackboard_updated",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          session_id: "war-room-1",
          consensus_state: "draft_ready",
        },
      },
      {
        event_type: "war_room_closed",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          session_id: "war-room-1",
          resolution_type: "consensus",
          resolution_note: "Consensus reached and session closed.",
        },
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "War Room",
    });
    expect(messages[0]?.content).toContain("War room opened");
    expect(messages[1]?.content).toContain("consensus draft_ready");
    expect(messages[2]?.content).toContain(
      "Consensus reached and session closed.",
    );
  });

  it("renders chat collaboration lifecycle events in chat timeline", () => {
    const messages = toSessionChatMessages([
      {
        event_type: "chat_participant_invited",
        timestamp: "2026-03-25T00:00:00.000Z",
        payload: {
          agent_profile: "reviewer_agent",
          role: "participant",
          invited_by: "ui:alice",
        },
      },
      {
        event_type: "chat_participant_joined",
        timestamp: "2026-03-25T00:00:01.000Z",
        payload: {
          agent_profile: "reviewer_agent",
        },
      },
      {
        event_type: "chat_participant_invite_denied",
        timestamp: "2026-03-25T00:00:02.000Z",
        payload: {
          agent_profile: "ops_agent",
          denial_reason: "target_agent_not_allowed_by_chat_policy_matrix",
        },
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: "event",
      label: "Chat",
      content: "Invited reviewer_agent as participant by ui:alice",
    });
    expect(messages[1]).toMatchObject({
      role: "event",
      label: "Chat",
      content: "reviewer_agent joined the chat",
    });
    expect(messages[2]).toMatchObject({
      role: "event",
      label: "Chat",
    });
    expect(messages[2]?.content).toContain(
      "target_agent_not_allowed_by_chat_policy_matrix",
    );
  });

  describe("user_questions_posed / user_question_answers events", () => {
    it("renders user_questions_posed as an event message with formatted questions", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [
              {
                question: "Which framework?",
                options: ["React", "Vue", "Angular"],
              },
              { question: "Any other notes?", options: [] },
            ],
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "event",
        label: "Questions from Agent",
        questions: [
          {
            question: "Which framework?",
            options: ["React", "Vue", "Angular"],
          },
          { question: "Any other notes?", options: [] },
        ],
      });
      expect(messages[0].content).toContain("Q1: Which framework?");
      expect(messages[0].content).toContain("[React / Vue / Angular]");
      expect(messages[0].content).toContain("Q2: Any other notes?");
    });

    it("renders user_question_answers as a user message with formatted answers", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "user_question_answers",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            answers: [
              {
                questionIndex: 0,
                selectedOption: "React",
                freeTextAnswer: null,
              },
              {
                questionIndex: 1,
                selectedOption: null,
                freeTextAnswer: "Use TypeScript",
              },
            ],
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "user",
        label: "Your Answers",
      });
      expect(messages[0].content).toContain("Q1: Selected: React");
      expect(messages[0].content).toContain("Q2: Answer: Use TypeScript");
    });

    it("skips user_questions_posed with empty questions array", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: { questions: [] },
        },
      ]);

      expect(messages).toHaveLength(0);
    });

    it("renders user_message_delivery_failed as a system event", () => {
      const messages = toSessionChatMessages([
        {
          event_type: "user_message_delivery_failed",
          timestamp: "2026-03-25T00:00:02.000Z",
          payload: {
            message: "Please rerun unit tests",
            reason: "no_active_container_or_saved_session",
          },
        },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "event",
        label: "Delivery Failed",
      });
      expect(messages[0].content).toContain(
        "Operator guidance was not delivered: Please rerun unit tests",
      );
      expect(messages[0].content).toContain(
        "Reason: no_active_container_or_saved_session",
      );
    });
  });

  describe("getPendingQuestions", () => {
    it("returns questions when user_questions_posed has no matching answers", () => {
      const questions = getPendingQuestions([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [{ question: "Pick a color", options: ["Red", "Blue"] }],
          },
        },
      ]);

      expect(questions).toHaveLength(1);
      expect(questions).not.toBeNull();
      expect(questions?.[0]?.question).toBe("Pick a color");
    });

    it("returns null when questions have been answered", () => {
      const questions = getPendingQuestions([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [{ question: "Pick a color", options: ["Red", "Blue"] }],
          },
        },
        {
          event_type: "user_question_answers",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            answers: [
              { questionIndex: 0, selectedOption: "Red", freeTextAnswer: null },
            ],
          },
        },
      ]);

      expect(questions).toBeNull();
    });

    it("returns null when a terminal turn completes after questions are posed", () => {
      const questions = getPendingQuestions([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [{ question: "Pick a color", options: ["Red", "Blue"] }],
          },
        },
        {
          event_type: "turn_end",
          timestamp: "2026-03-25T00:00:10.000Z",
          payload: {
            output: {
              stopReason: "stop",
            },
          },
        },
      ]);

      expect(questions).toBeNull();
    });

    it("returns null when step_complete occurs after questions are posed", () => {
      const questions = getPendingQuestions([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [{ question: "Pick a color", options: ["Red", "Blue"] }],
          },
        },
        {
          event_type: "step_complete",
          timestamp: "2026-03-25T00:00:10.000Z",
          payload: {
            summary: "done",
          },
        },
      ]);

      expect(questions).toBeNull();
    });

    it("returns latest questions when multiple rounds of questions exist", () => {
      const questions = getPendingQuestions([
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            questions: [{ question: "First?", options: [] }],
          },
        },
        {
          event_type: "user_question_answers",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            answers: [
              { questionIndex: 0, selectedOption: null, freeTextAnswer: "yes" },
            ],
          },
        },
        {
          event_type: "user_questions_posed",
          timestamp: "2026-03-25T00:00:02.000Z",
          payload: {
            questions: [{ question: "Second?", options: ["A", "B"] }],
          },
        },
      ]);

      expect(questions).toHaveLength(1);
      expect(questions).not.toBeNull();
      expect(questions?.[0]?.question).toBe("Second?");
    });

    it("returns null when no question events exist", () => {
      const questions = getPendingQuestions([
        {
          event_type: "agent_telemetry",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: { type: "text_delta", delta: "Hello" },
        },
      ]);

      expect(questions).toBeNull();
    });

    it("infers pending questions from ask_user_questions tool start", () => {
      const questions = getPendingQuestions([
        {
          event_type: "tool_execution_start",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            toolName: "ask_user_questions",
            toolCallId: "call-1",
            args: {
              questions: [
                {
                  question: "What type of app?",
                  options: ["Web", "Mobile", "Other"],
                },
              ],
            },
          },
        },
      ]);

      expect(questions).toHaveLength(1);
      expect(questions).not.toBeNull();
      expect(questions?.[0]?.question).toBe("What type of app?");
    });

    it("keeps inferred pending questions when ask_user_questions completes without error", () => {
      const questions = getPendingQuestions([
        {
          event_type: "tool_execution_start",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            toolName: "ask_user_questions",
            toolCallId: "call-1",
            args: {
              questions: [
                {
                  question: "What type of app?",
                  options: ["Web", "Mobile", "Other"],
                },
              ],
            },
          },
        },
        {
          event_type: "tool_execution_end",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            toolName: "ask_user_questions",
            toolCallId: "call-1",
            isError: false,
            result: {
              content: [{ type: "text", text: "Questions shown" }],
            },
          },
        },
      ]);

      expect(questions).toHaveLength(1);
      expect(questions?.[0]?.question).toBe("What type of app?");
    });

    it("clears inferred pending questions when ask_user_questions fails", () => {
      const questions = getPendingQuestions([
        {
          event_type: "tool_execution_start",
          timestamp: "2026-03-25T00:00:00.000Z",
          payload: {
            toolName: "ask_user_questions",
            toolCallId: "call-1",
            args: {
              questions: [
                {
                  question: "What type of app?",
                  options: ["Web", "Mobile", "Other"],
                },
              ],
            },
          },
        },
        {
          event_type: "tool_execution_end",
          timestamp: "2026-03-25T00:00:01.000Z",
          payload: {
            toolName: "ask_user_questions",
            toolCallId: "call-1",
            isError: true,
            result: {
              content: [{ type: "text", text: "Validation failed" }],
            },
          },
        },
      ]);

      expect(questions).toBeNull();
    });
  });
});
