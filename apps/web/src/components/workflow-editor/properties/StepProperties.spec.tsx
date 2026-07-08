import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { StepProperties } from "./StepProperties";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type { StepNodeData } from "../serialization/types";
import type { StepNode } from "../serialization/types";

vi.mock("@/hooks/useHarnesses", () => ({
  useHarnesses: () => ({ data: [], isLoading: false }),
}));

function createStepNode(
  overrides: Partial<StepNodeData> = {},
  id = "step-1",
): StepNode {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      label: "Test Step",
      stepType: "agent",
      stepId: "step-1",
      parentJobId: "job-1",
      ...overrides,
    },
  };
}

function renderProperties() {
  return render(<StepProperties />);
}

const STEP_TYPE_OPTIONS = [
  { value: "agent", label: "Agent" },
  { value: "run_command", label: "Command" },
  { value: "set_variable", label: "Set Variable" },
  { value: "wait", label: "Wait" },
];

const ON_ERROR_OPTIONS = [
  { value: "fail", label: "Fail" },
  { value: "continue", label: "Continue" },
  { value: "goto:", label: "GoTo <step-id>" },
];

const PROMPT_MODE_OPTIONS = [
  { value: "override", label: "Override" },
  { value: "append", label: "Append" },
];

describe("StepProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  describe("no step selected", () => {
    it("returns null when no node is selected", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        nodes: [createStepNode()],
      });

      const { container } = renderProperties();

      expect(container.firstChild).toBeNull();
    });

    it("returns null when selected node is not a step", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "job-1",
        nodes: [
          {
            id: "job-1",
            type: "job",
            position: { x: 0, y: 0 },
            data: { label: "Job", jobType: "execution", jobId: "job-1" },
          },
        ],
      });

      const { container } = renderProperties();

      expect(container.firstChild).toBeNull();
    });
  });

  describe("step id and type", () => {
    it("renders step ID as read-only text", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepId: "step-1" })],
      });

      renderProperties();

      expect(screen.getByText("Step ID")).toBeTruthy();
      expect(screen.getByText("step-1")).toBeTruthy();
    });

    it("renders step type selector with current value", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "run_command" })],
      });

      renderProperties();

      const typeSelect = screen.getByRole("combobox", { name: "Type" });
      expect(typeSelect).toBeTruthy();
      expect(typeSelect.textContent).toContain("Command");
    });

    it("changes step type in store when selector changes", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "agent" })],
      });

      renderProperties();

      const typeSelect = screen.getByRole("combobox", { name: "Type" });
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "Wait" }));

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.stepType).toBe("wait");
    });
  });

  describe("agent type fields", () => {
    it("renders prompt, prompt_file, and prompt_mode when stepType is agent", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [
          createStepNode({
            stepType: "agent",
            prompt: "Do something",
            promptFile: "prompt.txt",
            promptMode: "override",
          }),
        ],
      });

      renderProperties();

      expect(screen.getByRole("textbox", { name: "Prompt" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Prompt File" })).toBeTruthy();
      expect(
        screen.getByRole("combobox", { name: "Prompt Mode" }),
      ).toBeTruthy();
    });

    it("reads prompt value from store", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "agent", prompt: "Hello world" })],
      });

      renderProperties();

      const textarea = screen.getByRole("textbox", {
        name: "Prompt",
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe("Hello world");
    });

    it("writes prompt to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "agent", prompt: "" })],
      });

      renderProperties();

      const textarea = screen.getByRole("textbox", { name: "Prompt" });
      await user.type(textarea, "New prompt");

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.prompt).toBe("New prompt");
    });

    it("writes prompt_mode to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "agent", promptMode: "override" })],
      });

      renderProperties();

      const modeSelect = screen.getByRole("combobox", { name: "Prompt Mode" });
      await user.click(modeSelect);
      await user.click(screen.getByRole("option", { name: "Append" }));

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.promptMode).toBe("append");
    });
  });

  describe("run_command type fields", () => {
    it("renders command and working_dir when stepType is run_command", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [
          createStepNode({
            stepType: "run_command",
            command: "echo hello",
            workingDir: "/tmp",
          }),
        ],
      });

      renderProperties();

      expect(screen.getByRole("textbox", { name: "Command" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Working Dir" })).toBeTruthy();
    });

    it("writes command to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "run_command", command: "" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Command" });
      await user.type(input, "ls -la");

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.command).toBe("ls -la");
    });

    it("writes working_dir to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "run_command", workingDir: "" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Working Dir" });
      await user.type(input, "/home");

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.workingDir).toBe("/home");
    });
  });

  describe("set_variable type fields", () => {
    it("renders variables field when stepType is set_variable", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [
          createStepNode({
            stepType: "set_variable",
            variables: { KEY: "value" },
          }),
        ],
      });

      renderProperties();

      expect(screen.getByText("Variables")).toBeTruthy();
    });
  });

  describe("wait type fields", () => {
    it("renders timeout_ms field when stepType is wait", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "wait", timeoutMs: 5000 })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", {
        name: "Timeout (ms)",
      }) as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe("5000");
    });

    it("writes timeout_ms to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "wait" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", {
        name: "Timeout (ms)",
      }) as HTMLInputElement;
      expect(input.value).toBe("");
      await user.type(input, "3000");

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.timeoutMs).toBe(3000);
    });
  });

  describe("common fields", () => {
    it("renders on_error selector", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ onError: "fail" })],
      });

      renderProperties();

      expect(screen.getByRole("combobox", { name: "On Error" })).toBeTruthy();
    });

    it("renders if condition field", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ if: "{{eq step.status 'done'}}" })],
      });

      renderProperties();

      expect(
        screen.getByRole("textbox", { name: "If Condition" }),
      ).toBeTruthy();
    });

    it("writes on_error to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ onError: "fail" })],
      });

      renderProperties();

      const select = screen.getByRole("combobox", { name: "On Error" });
      await user.click(select);
      await user.click(screen.getByRole("option", { name: "Continue" }));

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.onError).toBe("continue");
    });

    it("writes if condition to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ if: "" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "If Condition" });
      await user.type(input, "{{{{eq step.status 'done'}}");

      const nodes = useWorkflowEditorStore.getState().nodes as StepNode[];
      expect(nodes[0].data.if).toBe("{{eq step.status 'done'}}");
    });
  });

  describe("pushAction for undo", () => {
    it("pushes an update_node_data action when step type changes", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "step-1",
        nodes: [createStepNode({ stepType: "agent" })],
      });

      renderProperties();

      const typeSelect = screen.getByRole("combobox", { name: "Type" });
      await user.click(typeSelect);
      await user.click(screen.getByRole("option", { name: "Wait" }));

      const undoStack = useWorkflowEditorStore.getState().undoStack;
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
      const lastAction = undoStack[undoStack.length - 1];
      expect(lastAction.type).toBe("update_node_data");
    });
  });
});
