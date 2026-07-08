import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { AgentCommunicationThreadPanel } from "./AgentCommunicationThreadPanel";

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

describe("AgentCommunicationThreadPanel", () => {
  it("renders empty state when there are no mesh thread events", () => {
    render(
      <AgentCommunicationThreadPanel
        events={[
          event({
            event_type: "container_started",
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("No agent mesh threads recorded for this run."),
    ).toBeTruthy();
  });

  it("renders grouped thread summaries with status, target profile, and updated timestamp", () => {
    render(
      <AgentCommunicationThreadPanel
        events={[
          event({
            event_type: "agent_mention_requested",
            timestamp: "2026-04-05T10:00:00.000Z",
            payload: {
              thread_id: "thread-a",
              target_profile: "frontend_agent",
            },
          }),
          event({
            event_type: "agent_mention_responded",
            timestamp: "2026-04-05T10:01:00.000Z",
            payload: { thread_id: "thread-a" },
          }),
          event({
            event_type: "agent_mention_requested",
            timestamp: "2026-04-05T10:02:00.000Z",
            payload: { thread_id: "thread-b", target_profile: "qa_agent" },
          }),
          event({
            event_type: "agent_mention_timeout",
            timestamp: "2026-04-05T10:03:00.000Z",
            payload: { thread_id: "thread-b" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("thread-a")).toBeTruthy();
    expect(screen.getByText("thread-b")).toBeTruthy();
    expect(screen.getByText("responded")).toBeTruthy();
    expect(screen.getByText("timeout")).toBeTruthy();
    expect(screen.getByText("Target profile: frontend_agent")).toBeTruthy();
    expect(screen.getByText("Target profile: qa_agent")).toBeTruthy();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it("renders resolution note for resolved thread events", () => {
    render(
      <AgentCommunicationThreadPanel
        events={[
          event({
            event_type: "agent_mention_requested",
            payload: { thread_id: "thread-c", target_profile: "review_agent" },
          }),
          event({
            event_type: "agent_thread_resolved",
            timestamp: "2026-04-05T10:00:10.000Z",
            payload: {
              thread_id: "thread-c",
              resolution_note: "Merged final recommendation and closed thread.",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("resolved")).toBeTruthy();
    expect(
      screen.getByText("Merged final recommendation and closed thread."),
    ).toBeTruthy();
  });
});
