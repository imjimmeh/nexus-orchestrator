import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkflowEditorPropertiesPanel } from "./WorkflowEditorPropertiesPanel";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import type { WorkflowEdgeData } from "./serialization/types";
import { makeJobNode } from "./properties/jobs/test-helpers";

vi.mock("@/hooks/useHarnesses", () => ({
  useHarnesses: () => ({ data: [], isLoading: false }),
}));

describe("WorkflowEditorPropertiesPanel", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("renders workflow properties when no element is selected", () => {
    useWorkflowEditorStore.setState({ selectedElementId: null });
    render(<WorkflowEditorPropertiesPanel />);
    expect(screen.getByText("General")).toBeTruthy();
  });

  it("renders job properties when a job node is selected", () => {
    const node = makeJobNode("job-1", {
      jobType: "execution",
      jobId: "exec-1",
    });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "job-1",
    });
    render(<WorkflowEditorPropertiesPanel />);
    expect(screen.getByText("Execution Properties")).toBeTruthy();
  });

  it("renders step properties when a step node is selected", () => {
    useWorkflowEditorStore.setState({
      nodes: [
        {
          id: "step-1",
          type: "step",
          position: { x: 0, y: 0 },
          data: {
            label: "Test Step",
            stepType: "agent",
            stepId: "s-1",
            parentJobId: "j-1",
          },
        },
      ],
      selectedElementId: "step-1",
    });
    render(<WorkflowEditorPropertiesPanel />);
    expect(screen.getByText("Step Properties")).toBeTruthy();
  });

  it("renders edge properties when an edge is selected", () => {
    useWorkflowEditorStore.setState({
      nodes: [],
      edges: [
        {
          id: "edge-1",
          source: "a",
          target: "b",
          data: { kind: "dependency" } as WorkflowEdgeData,
        },
      ],
      selectedElementId: "edge-1",
    });
    render(<WorkflowEditorPropertiesPanel />);
    expect(screen.getByText("Edge Properties")).toBeTruthy();
  });

  it("collapses and expands via toggle button", () => {
    useWorkflowEditorStore.setState({ selectedElementId: null });
    render(<WorkflowEditorPropertiesPanel />);

    expect(screen.getByText("General")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle Properties Panel" }),
    );

    expect(screen.queryByText("General")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle Properties Panel" }),
    );

    expect(screen.getByText("General")).toBeTruthy();
  });

  it("shows properties header even when collapsed", () => {
    useWorkflowEditorStore.setState({ selectedElementId: null });
    render(<WorkflowEditorPropertiesPanel />);

    const toggleButton = screen.getByRole("button", {
      name: "Toggle Properties Panel",
    });
    fireEvent.click(toggleButton);

    expect(screen.getByText("Properties")).toBeTruthy();
  });

  describe("validation errors", () => {
    it("renders validation error alert when errors are present", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        validationErrors: {
          name: "Name is required",
          "jobs[0].id": "Job id must be unique",
        },
        isDirty: false,
      });
      render(<WorkflowEditorPropertiesPanel />);

      expect(screen.getByText("2 validation errors")).toBeTruthy();
      expect(screen.getByText("name")).toBeTruthy();
      expect(screen.getByText("Name is required")).toBeTruthy();
      expect(screen.getByText("jobs[0].id")).toBeTruthy();
      expect(screen.getByText("Job id must be unique")).toBeTruthy();
    });

    it("does not render validation error alert when errors are empty", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        validationErrors: {},
        isDirty: false,
      });
      render(<WorkflowEditorPropertiesPanel />);

      expect(screen.queryByText(/validation error/i)).toBeNull();
    });

    it("persists validation errors when isDirty becomes true", async () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        validationErrors: { name: "Required" },
        isDirty: false,
      });
      render(<WorkflowEditorPropertiesPanel />);

      expect(screen.getByText("1 validation error")).toBeTruthy();

      act(() => {
        useWorkflowEditorStore.setState({ isDirty: true });
      });

      expect(useWorkflowEditorStore.getState().validationErrors).toEqual({
        name: "Required",
      });
    });
  });
});
