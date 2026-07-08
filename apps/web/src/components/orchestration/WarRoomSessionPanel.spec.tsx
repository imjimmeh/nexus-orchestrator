import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { WarRoomSessionPanel } from "./WarRoomSessionPanel";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
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

describe("WarRoomSessionPanel", () => {
  it("renders empty state when no war-room events are present", () => {
    renderWithQuery(
      <WarRoomSessionPanel
        events={[
          event({
            event_type: "container_started",
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("No war-room sessions recorded for this run."),
    ).toBeTruthy();
  });

  it("renders grouped war-room summaries with latest status and event type", () => {
    renderWithQuery(
      <WarRoomSessionPanel
        events={[
          event({
            event_type: "war_room_opened",
            timestamp: "2026-04-05T10:00:00.000Z",
            payload: {
              session_id: "war-room-a",
              consensus_state: "collecting_input",
            },
          }),
          event({
            event_type: "war_room_signoff_submitted",
            timestamp: "2026-04-05T10:01:00.000Z",
            payload: {
              session_id: "war-room-a",
              consensus_state: "partial_signoff",
            },
          }),
          event({
            event_type: "war_room_opened",
            timestamp: "2026-04-05T10:02:00.000Z",
            payload: {
              session_id: "war-room-b",
              consensus_state: "collecting_input",
            },
          }),
          event({
            event_type: "war_room_deadlocked",
            timestamp: "2026-04-05T10:03:00.000Z",
            payload: {
              session_id: "war-room-b",
              consensus_state: "deadlocked",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("war-room-a")).toBeTruthy();
    expect(screen.getByText("war-room-b")).toBeTruthy();
    expect(screen.getByText("signoff")).toBeTruthy();
    expect(screen.getByText("deadlocked")).toBeTruthy();
    expect(screen.getByText("Consensus state: partial_signoff")).toBeTruthy();
    expect(screen.getByText("Consensus state: deadlocked")).toBeTruthy();
  });

  it("renders resolution details for closed sessions", () => {
    renderWithQuery(
      <WarRoomSessionPanel
        events={[
          event({
            event_type: "war_room_opened",
            payload: {
              session_id: "war-room-c",
            },
          }),
          event({
            event_type: "war_room_closed",
            timestamp: "2026-04-05T10:01:00.000Z",
            payload: {
              session_id: "war-room-c",
              resolution_type: "consensus",
              resolution_note:
                "Consensus reached after QA and architect signoff.",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("closed")).toBeTruthy();
    expect(screen.getByText("Resolution: consensus")).toBeTruthy();
    expect(
      screen.getByText("Consensus reached after QA and architect signoff."),
    ).toBeTruthy();
  });
});
