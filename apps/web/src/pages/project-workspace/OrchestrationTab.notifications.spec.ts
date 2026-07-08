import { describe, expect, it } from "vitest";
import { ProjectOrchestrationDecisionEntry } from "@/lib/api/projects.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { buildOrchestrationNotifications } from "./OrchestrationTab.notifications";

function decision(
  overrides: Partial<ProjectOrchestrationDecisionEntry>,
): ProjectOrchestrationDecisionEntry {
  return {
    timestamp: "2026-04-05T10:00:00.000Z",
    type: "analysis",
    reasoning: "Default reasoning",
    actions: [],
    executionStatus: "executed",
    ...overrides,
  };
}

function event(
  overrides: Partial<WorkflowTelemetryEvent>,
): WorkflowTelemetryEvent {
  return {
    event_type: "step_start",
    timestamp: "2026-04-05T10:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("buildOrchestrationNotifications", () => {
  it("maps mesh workflow events into agent_mesh notifications", () => {
    const notifications = buildOrchestrationNotifications({
      status: "orchestrating",
      revisionFeedback: null,
      decisionLog: [],
      workItems: [],
      workflowEvents: [
        event({
          event_type: "agent_mention_requested",
          payload: { thread_id: "thread-1", target_profile: "qa_agent" },
        }),
        event({
          event_type: "agent_thread_resolved",
          timestamp: "2026-04-05T10:00:01.000Z",
          payload: { thread_id: "thread-1" },
        }),
        event({
          event_type: "container_started",
          timestamp: "2026-04-05T10:00:02.000Z",
        }),
      ],
    });

    const mesh = notifications.filter(
      (notification) => notification.category === "agent_mesh",
    );

    expect(mesh).toHaveLength(2);
    expect(mesh.map((notification) => notification.title)).toEqual(
      expect.arrayContaining([
        "Agent Mention Requested",
        "Agent Thread Resolved",
      ]),
    );
  });

  it("maps timeout and denied mesh events to warning severity", () => {
    const notifications = buildOrchestrationNotifications({
      status: "orchestrating",
      revisionFeedback: null,
      decisionLog: [],
      workItems: [],
      workflowEvents: [
        event({
          event_type: "agent_mention_timeout",
          payload: { thread_id: "thread-2" },
        }),
        event({
          event_type: "agent_mention_denied",
          timestamp: "2026-04-05T10:00:01.000Z",
          payload: { thread_id: "thread-3", reason: "Policy denied request." },
        }),
      ],
    });

    expect(
      notifications.find((item) => item.title === "Agent Mention Timed Out")
        ?.severity,
    ).toBe("warning");
    expect(
      notifications.find((item) => item.title === "Agent Mention Denied")
        ?.severity,
    ).toBe("warning");
  });

  it("maps mention/thread/mesh decision types to agent_mesh category", () => {
    const notifications = buildOrchestrationNotifications({
      status: "orchestrating",
      revisionFeedback: null,
      decisionLog: [
        decision({
          type: "mention_routing",
          timestamp: "2026-04-05T10:00:00Z",
        }),
        decision({
          type: "thread_resolution_plan",
          timestamp: "2026-04-05T10:00:01Z",
        }),
        decision({
          type: "mesh_health_check",
          timestamp: "2026-04-05T10:00:02Z",
        }),
      ],
      workItems: [],
      workflowEvents: [],
    });

    const decisionNotifications = notifications.filter((item) =>
      item.title.startsWith("Decision: "),
    );

    expect(decisionNotifications).toHaveLength(3);
    expect(
      decisionNotifications.every((item) => item.category === "agent_mesh"),
    ).toBe(true);
  });

  it("maps war-room workflow events into war_room notifications", () => {
    const notifications = buildOrchestrationNotifications({
      status: "orchestrating",
      revisionFeedback: null,
      decisionLog: [],
      workItems: [],
      workflowEvents: [
        event({
          event_type: "war_room_opened",
          payload: { session_id: "war-room-1" },
        }),
        event({
          event_type: "war_room_deadlocked",
          timestamp: "2026-04-05T10:00:01.000Z",
          payload: { session_id: "war-room-1" },
        }),
      ],
    });

    const warRoom = notifications.filter(
      (notification) => notification.category === "war_room",
    );

    expect(warRoom).toHaveLength(2);
    expect(warRoom.map((notification) => notification.title)).toEqual(
      expect.arrayContaining(["War Room Opened", "War Room Deadlocked"]),
    );
    expect(
      warRoom.find(
        (notification) => notification.title === "War Room Deadlocked",
      )?.severity,
    ).toBe("warning");
  });
});
