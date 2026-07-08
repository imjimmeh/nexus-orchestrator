import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { RunCommandProperties } from "./RunCommandProperties";
import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { makeJobNode } from "./test-helpers";

describe("RunCommandProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("returns null when node is not found", () => {
    useWorkflowEditorStore.setState({ nodes: [] });
    const { container } = render(<RunCommandProperties nodeId="missing" />);
    expect(container.firstChild).toBeNull();
  });

  describe("command field", () => {
    it("renders command text field with stored value", () => {
      const node = makeJobNode("node-1", {
        command: "npm run build",
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Command",
      }) as HTMLInputElement;
      expect(input.value).toBe("npm run build");
    });

    it("writes command to store on change", async () => {
      const user = userEvent.setup();
      const node = makeJobNode("node-1", {
        command: "",
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", { name: "Command" });
      await user.clear(input);
      await user.type(input, "echo hello");

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.command).toBe("echo hello");
    });
  });

  describe("working_dir field", () => {
    it("renders working_dir text field with stored value", () => {
      const node = makeJobNode("node-1", {
        workingDir: "/home/runner",
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Working Directory",
      }) as HTMLInputElement;
      expect(input.value).toBe("/home/runner");
    });

    it("writes working_dir to store on change", async () => {
      const user = userEvent.setup();
      const node = makeJobNode("node-1", {
        workingDir: "",
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Working Directory",
      });
      await user.clear(input);
      await user.type(input, "/tmp/build");

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.workingDir).toBe("/tmp/build");
    });
  });

  describe("timeout_ms field", () => {
    it("renders timeout_ms as number input", () => {
      const node = makeJobNode("node-1", {
        timeoutMs: 30000,
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Timeout (ms)",
      }) as HTMLInputElement;
      expect(input.value).toBe("30000");
    });

    it("updates timeout_ms in store", () => {
      const node = makeJobNode("node-1", {
        timeoutMs: 5000,
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Timeout (ms)",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "60000" } });

      const nodes = useWorkflowEditorStore.getState().nodes;
      const updated = nodes[0].data as JobNodeData;
      expect(updated.timeoutMs).toBe(60000);
    });
  });

  describe("undo integration", () => {
    it("pushes undo action when command is changed", () => {
      const node = makeJobNode("node-1", {
        command: "old",
        jobType: "run_command",
        jobId: "cmd-1",
      });
      useWorkflowEditorStore.setState({ nodes: [node] });
      render(<RunCommandProperties nodeId="node-1" />);

      const input = screen.getByRole("textbox", {
        name: "Command",
      }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "new-command" } });

      const undoStack = useWorkflowEditorStore.getState().undoStack;
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
    });
  });
});
