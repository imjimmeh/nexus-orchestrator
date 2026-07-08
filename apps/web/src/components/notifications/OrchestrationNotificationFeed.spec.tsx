import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OrchestrationNotificationFeed,
  type OrchestrationNotification,
} from "./OrchestrationNotificationFeed";

const notifications: OrchestrationNotification[] = [
  {
    id: "lifecycle-1",
    category: "lifecycle",
    title: "Workflow started",
    message: "Workflow run has started.",
    timestamp: "2026-04-05T10:00:00.000Z",
    severity: "info",
  },
  {
    id: "mesh-1",
    category: "agent_mesh",
    title: "Mesh timeout",
    message: "Peer assistance request timed out.",
    timestamp: "2026-04-05T10:00:01.000Z",
    severity: "warning",
  },
  {
    id: "war-room-1",
    category: "war_room",
    title: "War room opened",
    message: "Session war-room-1 opened.",
    timestamp: "2026-04-05T10:00:02.000Z",
    severity: "info",
  },
];

describe("OrchestrationNotificationFeed", () => {
  it("renders an agent_mesh filter button", () => {
    render(<OrchestrationNotificationFeed items={notifications} />);

    expect(
      screen.getByRole("button", {
        name: "agent_mesh",
      }),
    ).toBeTruthy();
  });

  it("renders a war_room filter button", () => {
    render(<OrchestrationNotificationFeed items={notifications} />);

    expect(
      screen.getByRole("button", {
        name: "war_room",
      }),
    ).toBeTruthy();
  });

  it("shows only agent_mesh notifications when agent_mesh filter is selected", () => {
    render(<OrchestrationNotificationFeed items={notifications} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "agent_mesh",
      }),
    );

    expect(screen.getByText("Mesh timeout")).toBeTruthy();
    expect(screen.queryByText("Workflow started")).toBeNull();
  });

  it("shows only war_room notifications when war_room filter is selected", () => {
    render(<OrchestrationNotificationFeed items={notifications} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "war_room",
      }),
    );

    expect(screen.getByText("War room opened")).toBeTruthy();
    expect(screen.queryByText("Mesh timeout")).toBeNull();
  });
});
