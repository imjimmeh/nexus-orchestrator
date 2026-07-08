import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  type WorkflowActivityFeedFilters,
  WorkflowActivityFeed,
} from "./WorkflowActivityFeed";

const EVENTS: WorkflowTelemetryEvent[] = [
  {
    event_type: "step_start",
    timestamp: "2026-04-19T10:00:00.000Z",
    payload: {
      stepId: "plan",
      message: "Planning started",
    },
  },
  {
    event_type: "tool_execution_end",
    timestamp: "2026-04-19T10:01:00.000Z",
    payload: {
      toolName: "build_repo",
      outcome: "success",
    },
  },
  {
    event_type: "step_failed",
    timestamp: "2026-04-19T10:02:00.000Z",
    payload: {
      error: "Workflow failed due to missing artifact",
    },
  },
];

describe("WorkflowActivityFeed", () => {
  it("renders workflow and tool entries in unified feed", () => {
    render(<WorkflowActivityFeed events={EVENTS} isLoading={false} />);

    expect(screen.getByText("step_start")).toBeTruthy();
    expect(screen.getByText("tool_execution_end")).toBeTruthy();
  });

  it("filters by search query", () => {
    render(<WorkflowActivityFeed events={EVENTS} isLoading={false} />);

    fireEvent.change(screen.getByLabelText("Search activity"), {
      target: { value: "build_repo" },
    });

    expect(screen.queryByText("step_start")).toBeNull();
    expect(screen.getByText("tool_execution_end")).toBeTruthy();
  });

  it("supports workflow/tool and failures-only checkboxes", () => {
    render(<WorkflowActivityFeed events={EVENTS} isLoading={false} />);

    fireEvent.click(screen.getByLabelText("Workflow events"));
    expect(screen.queryByText("step_start")).toBeNull();
    expect(screen.getByText("tool_execution_end")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Workflow events"));
    fireEvent.click(screen.getByLabelText("Tool events"));
    fireEvent.click(screen.getByLabelText("Failures only"));

    expect(screen.getByText("step_failed")).toBeTruthy();
    expect(screen.queryByText("tool_execution_end")).toBeNull();
  });

  it("supports quick-chip filtering by event type", () => {
    render(<WorkflowActivityFeed events={EVENTS} isLoading={false} />);

    fireEvent.click(screen.getByLabelText("Quick filter Tool"));

    expect(screen.queryByText("step_start")).toBeNull();
    expect(screen.getByText("tool_execution_end")).toBeTruthy();
    expect(screen.queryByText("step_failed")).toBeNull();
  });

  it("supports controlled filter mode", () => {
    const controlledFilters: WorkflowActivityFeedFilters = {
      searchQuery: "build_repo",
      showWorkflowEvents: false,
      showToolEvents: true,
      showFailuresOnly: false,
      quickType: "tool",
    };

    render(
      <WorkflowActivityFeed
        events={EVENTS}
        isLoading={false}
        filters={controlledFilters}
      />,
    );

    expect(screen.getByDisplayValue("build_repo")).toBeTruthy();
    expect(screen.queryByText("step_start")).toBeNull();
    expect(screen.getByText("tool_execution_end")).toBeTruthy();
  });

  it("highlights provider rate-limit retry scheduled events", () => {
    render(
      <WorkflowActivityFeed
        events={[
          {
            event_type: "workflow.retry_scheduled",
            timestamp: "2026-04-19T10:03:00.000Z",
            payload: {
              reasonCode: "provider_rate_limit_429",
              nextRetryAt: "2026-04-19T10:08:00.000Z",
            },
          },
        ]}
        isLoading={false}
      />,
    );

    expect(screen.getByText("workflow.retry_scheduled")).toBeTruthy();
    expect(screen.getByText("Rate limit retry")).toBeTruthy();
  });
});
