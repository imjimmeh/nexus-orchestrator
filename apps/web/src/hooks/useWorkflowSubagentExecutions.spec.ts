import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  summarizeWorkflowSubagentExecutions,
  useWorkflowSubagentExecutions,
} from "./useWorkflowSubagentExecutions";
import { useQuery } from "@tanstack/react-query";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    getEventLedger: vi.fn(),
    getWorkflowRunEvents: vi.fn(),
  },
}));

describe("useWorkflowSubagentExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return the most recent status by processing events in ASC order (reversing LIFO API response)", () => {
    // Mock LIFO events (descending by timestamp)
    const mockEvents = [
      {
        id: "event-3",
        subagent_execution_id: "exec-1",
        event_name: "completion.succeeded",
        occurred_at: "2026-05-01T12:00:02.000Z",
        payload: { status: "completed" },
      },
      {
        id: "event-2",
        subagent_execution_id: "exec-1",
        event_name: "spawn.succeeded",
        occurred_at: "2026-05-01T12:00:01.000Z",
        payload: { status: "running" },
      },
      {
        id: "event-1",
        subagent_execution_id: "exec-1",
        event_name: "spawn.requested",
        occurred_at: "2026-05-01T12:00:00.000Z",
        payload: { status: "spawning" },
      },
    ];

    (useQuery as any).mockReturnValue({
      data: mockEvents,
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useWorkflowSubagentExecutions("run-1"));

    // ASSERTION: We expect the status to be 'completed' because it's the most recent event.
    expect(result.current.executions[0].status).toBe("completed");
    expect(result.current.executions[0].lastEventName).toBe(
      "completion.succeeded",
    );
  });

  it("should normalize status from recognized event names even without payload status", () => {
    const mockEvents = [
      {
        id: "event-1",
        subagent_execution_id: "exec-1",
        event_name: "spawn.requested",
        occurred_at: "2026-05-01T12:00:00.000Z",
        payload: {},
      },
    ];

    (useQuery as any).mockReturnValue({
      data: mockEvents,
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useWorkflowSubagentExecutions("run-1"));

    expect(result.current.executions[0].status).toBe("spawning");
  });

  it("should correctly identify failed status from various failure events", () => {
    const mockEvents = [
      {
        id: "event-1",
        subagent_execution_id: "exec-1",
        event_name: "spawn.execution_failed",
        occurred_at: "2026-05-01T12:00:00.000Z",
        payload: {},
      },
    ];

    (useQuery as any).mockReturnValue({
      data: mockEvents,
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useWorkflowSubagentExecutions("run-1"));

    expect(result.current.executions[0].status).toBe("failed");
  });

  it("should mark executions completed from nested wait_for_subagents telemetry", () => {
    const lifecycleEvents: EventLedgerRecord[] = [
      {
        id: "event-2",
        domain: "subagent",
        event_name: "spawn.succeeded",
        outcome: "success",
        severity: "info",
        source: "api",
        subagent_execution_id: "exec-1",
        occurred_at: "2026-05-01T12:00:01.000Z",
        payload: { status: "running", child_container_id: "container-1" },
      },
      {
        id: "event-1",
        domain: "subagent",
        event_name: "spawn.requested",
        outcome: "in_progress",
        severity: "info",
        source: "api",
        subagent_execution_id: "exec-1",
        occurred_at: "2026-05-01T12:00:00.000Z",
        payload: { status: "spawning" },
      },
    ];

    const telemetryEvents: WorkflowTelemetryEvent[] = [
      {
        event_type: "tool_execution_end",
        timestamp: "2026-05-01T12:00:10.000Z",
        payload: {
          toolName: "nexus_orchestrator",
          args: { action: "wait_for_subagents" },
          result: {
            details: {
              status: "all_completed",
              results: {
                "exec-1": {
                  status: "Completed",
                  completed_at: "2026-05-01T12:00:09.000Z",
                },
              },
            },
          },
        },
      },
    ];

    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents,
      telemetryEvents,
    });

    expect(summaries).toEqual([
      {
        id: "exec-1",
        status: "completed",
        lastEventName: "wait_for_subagents",
        lastEventAt: "2026-05-01T12:00:09.000Z",
        childContainerId: "container-1",
      },
    ]);
  });

  it("preserves terminal lifecycle status when stale wait telemetry still says running", () => {
    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents: [
        {
          id: "event-3",
          domain: "subagent",
          event_name: "completion.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:10.000Z",
          payload: { status: "completed" },
        },
        {
          id: "event-2",
          domain: "subagent",
          event_name: "spawn.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:01.000Z",
          payload: { status: "running" },
        },
      ],
      telemetryEvents: [
        {
          event_type: "tool_execution_end",
          timestamp: "2026-05-01T12:00:11.000Z",
          payload: {
            toolName: "nexus_orchestrator",
            args: { action: "wait_for_subagents" },
            result: {
              details: {
                results: {
                  "exec-1": { status: "Running" },
                },
              },
            },
          },
        },
      ],
    });

    expect(summaries[0].status).toBe("completed");
    expect(summaries[0].lastEventName).toBe("completion.succeeded");
  });

  it("ignores stale telemetry updates older than the latest lifecycle event", () => {
    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents: [
        {
          id: "event-2",
          domain: "subagent",
          event_name: "spawn.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:05.000Z",
          payload: { status: "running", child_container_id: "container-1" },
        },
      ],
      telemetryEvents: [
        {
          event_type: "tool_execution_end",
          timestamp: "2026-05-01T12:00:06.000Z",
          payload: {
            toolName: "nexus_orchestrator",
            args: { action: "wait_for_subagents" },
            result: {
              details: {
                results: {
                  "exec-1": {
                    status: "Completed",
                    completed_at: "2026-05-01T12:00:04.000Z",
                  },
                },
              },
            },
          },
        },
      ],
    });

    expect(summaries[0]).toEqual({
      id: "exec-1",
      status: "running",
      lastEventName: "spawn.succeeded",
      lastEventAt: "2026-05-01T12:00:05.000Z",
      childContainerId: "container-1",
    });
  });

  it("prevents terminal-to-active regression from telemetry even when telemetry is newer", () => {
    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents: [
        {
          id: "event-1",
          domain: "subagent",
          event_name: "completion.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:05.000Z",
          payload: { status: "completed" },
        },
      ],
      telemetryEvents: [
        {
          event_type: "tool_execution_end",
          timestamp: "2026-05-01T12:00:06.000Z",
          payload: {
            toolName: "nexus_orchestrator",
            args: { action: "wait_for_subagents" },
            result: {
              details: {
                results: {
                  "exec-1": {
                    status: "running",
                    completed_at: "2026-05-01T12:00:06.000Z",
                  },
                },
              },
            },
          },
        },
      ],
    });

    expect(summaries[0].status).toBe("completed");
    expect(summaries[0].lastEventName).toBe("completion.succeeded");
    expect(summaries[0].lastEventAt).toBe("2026-05-01T12:00:05.000Z");
  });

  it("uses telemetry event order for timestamp ties so later tie entries win", () => {
    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents: [
        {
          id: "event-1",
          domain: "subagent",
          event_name: "spawn.requested",
          outcome: "in_progress",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:00.000Z",
          payload: { status: "spawning" },
        },
      ],
      telemetryEvents: [
        {
          event_type: "tool_execution_end",
          timestamp: "2026-05-01T12:00:06.000Z",
          payload: {
            toolName: "nexus_orchestrator",
            args: { action: "wait_for_subagents" },
            result: {
              details: {
                results: {
                  "exec-1": {
                    status: "running",
                  },
                },
              },
            },
          },
        },
        {
          event_type: "tool_execution_end",
          timestamp: "2026-05-01T12:00:06.000Z",
          payload: {
            toolName: "nexus_orchestrator",
            args: { action: "wait_for_subagents" },
            result: {
              details: {
                results: {
                  "exec-1": {
                    status: "completed",
                  },
                },
              },
            },
          },
        },
      ],
    });

    expect(summaries[0].status).toBe("completed");
    expect(summaries[0].lastEventAt).toBe("2026-05-01T12:00:06.000Z");
    expect(summaries[0].lastEventName).toBe("wait_for_subagents");
  });

  it("keeps subagent chat session ids from lifecycle payloads", () => {
    const summaries = summarizeWorkflowSubagentExecutions({
      lifecycleEvents: [
        {
          id: "event-1",
          domain: "subagent",
          event_name: "spawn.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          subagent_execution_id: "exec-1",
          occurred_at: "2026-05-01T12:00:01.000Z",
          payload: {
            status: "running",
            subagent_chat_session_id: "chat-session-1",
          },
        },
      ],
    });

    expect(summaries[0].subagentChatSessionId).toBe("chat-session-1");
  });
});
