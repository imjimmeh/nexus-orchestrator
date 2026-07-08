import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { CommonJobFields } from "./CommonJobFields";
import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { makeJobNode } from "./test-helpers";

describe("CommonJobFields", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("returns null when node is not found", () => {
    useWorkflowEditorStore.setState({ nodes: [] });
    const { container } = render(<CommonJobFields nodeId="missing" />);
    expect(container.firstChild).toBeNull();
  });

  describe("tier select", () => {
    it("renders tier select with Light value", () => {
      const node = makeJobNode("node-1", { tier: "light" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const combobox = screen.getByRole("combobox", { name: "Tier" });
      expect(combobox).toBeTruthy();
      expect(combobox.textContent).toContain("Light");
    });

    it("renders tier select with Heavy value", () => {
      const node = makeJobNode("node-1", { tier: "heavy" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const combobox = screen.getByRole("combobox", { name: "Tier" });
      expect(combobox.textContent).toContain("Heavy");
    });

    it("updates tier in store when selection changes", async () => {
      const user = userEvent.setup();
      const node = makeJobNode("node-1", { tier: "light" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      await user.click(screen.getByRole("combobox", { name: "Tier" }));
      await user.click(screen.getByRole("option", { name: "Heavy" }));

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.tier).toBe("heavy");
    });
  });

  describe("condition field", () => {
    it("renders condition HandlebarsField with stored value", () => {
      const node = makeJobNode("node-1", { condition: "{{input.foo}}" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Condition",
      }) as HTMLInputElement;
      expect(input.value).toBe("{{input.foo}}");
    });

    it("writes condition to store on change", () => {
      const node = makeJobNode("node-1", { condition: "" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Condition",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "{{needs.previous}}" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.condition).toBe("{{needs.previous}}");
    });
  });

  describe("max retries field", () => {
    it("renders max retries as number input", () => {
      const node = makeJobNode("node-1", { maxRetries: 3 });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Max Retries",
      }) as HTMLInputElement;
      expect(input.value).toBe("3");
    });

    it("updates max retries in store", () => {
      const node = makeJobNode("node-1", { maxRetries: 1 });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Max Retries",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "5" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.maxRetries).toBe(5);
    });
  });

  describe("depends_on field", () => {
    it("renders depends_on as text input with comma-separated IDs", () => {
      const node = makeJobNode("node-1", {
        dependsOn: ["job-a", "job-b"],
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Depends On",
      }) as HTMLInputElement;
      expect(input.value).toBe("job-a, job-b");
    });

    it("writes depends_on to store as array", () => {
      const node = makeJobNode("node-1", { dependsOn: [] });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Depends On",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "job-x, job-y" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.dependsOn).toEqual(["job-x", "job-y"]);
    });
  });

  describe("jobId field", () => {
    it("renders jobId as text field", () => {
      const node = makeJobNode("node-1", { jobId: "my-execution-job" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Job ID",
      }) as HTMLInputElement;
      expect(input.value).toBe("my-execution-job");
    });
  });

  describe("undo integration", () => {
    it("pushes undo action when field is changed", () => {
      const node = makeJobNode("node-1", { tier: "light" });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<CommonJobFields nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Job ID",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "changed-id" } });

      const undoStack = useWorkflowEditorStore.getState().undoStack;
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
    });
  });
});
