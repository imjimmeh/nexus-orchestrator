import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { ExecutionJobProperties } from "./ExecutionJobProperties";
import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { makeJobNode } from "./test-helpers";

describe("ExecutionJobProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("returns null when node is not found", () => {
    useWorkflowEditorStore.setState({ nodes: [] });
    const { container } = render(<ExecutionJobProperties nodeId="missing" />);
    expect(container.firstChild).toBeNull();
  });

  describe("agent_profile field", () => {
    it("renders agent_profile text field with stored value", () => {
      const node = makeJobNode("node-1", {
        agentProfile: "code-reviewer",
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Agent Profile",
      }) as HTMLInputElement;
      expect(input.value).toBe("code-reviewer");
    });

    it("writes agent_profile to store on change", async () => {
      const user = userEvent.setup();
      const node = makeJobNode("node-1", {
        agentProfile: "",
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", { name: "Agent Profile" });
      await user.clear(input);
      await user.type(input, "bug-fixer");

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.agentProfile).toBe("bug-fixer");
    });
  });

  describe("max_step_loops field", () => {
    it("renders max_step_loops as number input", () => {
      const node = makeJobNode("node-1", {
        maxStepLoops: 10,
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Max Step Loops",
      }) as HTMLInputElement;
      expect(input.value).toBe("10");
    });

    it("updates max_step_loops in store", () => {
      const node = makeJobNode("node-1", {
        maxStepLoops: 5,
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Max Step Loops",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "20" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.maxStepLoops).toBe(20);
    });
  });

  describe("output_contract fields", () => {
    it("renders output_contract required as textarea", () => {
      const node = makeJobNode("node-1", {
        outputContract: { required: ["result", "summary"] },
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const textarea = screen.getByRole("textbox", {
        name: "Required Outputs",
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe("result, summary");
    });

    it("renders output_contract optional as textarea", () => {
      const node = makeJobNode("node-1", {
        outputContract: { required: [], optional: ["details"] },
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const textarea = screen.getByRole("textbox", {
        name: "Optional Outputs",
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe("details");
    });

    it("writes output_contract required to store as array", () => {
      const node = makeJobNode("node-1", {
        outputContract: { required: [] },
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const textarea = screen.getByRole("textbox", {
        name: "Required Outputs",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "a, b, c" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.outputContract?.required).toEqual(["a", "b", "c"]);
    });

    it("writes output_contract optional to store as array", () => {
      const node = makeJobNode("node-1", {
        outputContract: { required: [] },
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const textarea = screen.getByRole("textbox", {
        name: "Optional Outputs",
      }) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "x, y" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.outputContract?.optional).toEqual(["x", "y"]);
    });
  });

  describe("permissions section", () => {
    it("renders permissions collapsible section", () => {
      const node = makeJobNode("node-1", {
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      expect(screen.getByText("Permissions")).toBeTruthy();
    });
  });

  describe("undo integration", () => {
    it("pushes undo action when field is changed", () => {
      const node = makeJobNode("node-1", {
        agentProfile: "old",
        jobType: "execution",
        jobId: "exec-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<ExecutionJobProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Agent Profile",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "new-profile" } });

      const undoStack = useWorkflowEditorStore.getState().undoStack;
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
    });
  });
});
