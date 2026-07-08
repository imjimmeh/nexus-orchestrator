import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { JobProperties } from "./JobProperties";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import { makeJobNode } from "./jobs/test-helpers";

describe("JobProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("returns null when selectedElementId is null", () => {
    useWorkflowEditorStore.setState({ selectedElementId: null });
    const { container } = render(<JobProperties />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when node is not found", () => {
    useWorkflowEditorStore.setState({
      nodes: [],
      selectedElementId: "missing",
    });
    const { container } = render(<JobProperties />);
    expect(container.firstChild).toBeNull();
  });

  it("renders execution properties for execution job type", () => {
    const node = makeJobNode("node-1", { jobType: "execution" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-1",
    });
    render(<JobProperties />);
    expect(screen.getByText("Execution Properties")).toBeTruthy();
  });

  it("renders invoke_workflow properties for invoke_workflow job type", () => {
    const node = makeJobNode("node-2", { jobType: "invoke_workflow" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-2",
    });
    render(<JobProperties />);
    expect(screen.getByText("Invoke Workflow Properties")).toBeTruthy();
  });

  it("renders run_command properties for run_command job type", () => {
    const node = makeJobNode("node-3", { jobType: "run_command" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-3",
    });
    render(<JobProperties />);
    expect(screen.getByRole("textbox", { name: "Command" })).toBeTruthy();
  });

  it("renders emit_event properties for emit_event job type", () => {
    const node = makeJobNode("node-4", { jobType: "emit_event" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-4",
    });
    render(<JobProperties />);
    expect(screen.getByText("Emit Event Properties")).toBeTruthy();
  });

  it("renders http_webhook properties for http_webhook job type", () => {
    const node = makeJobNode("node-5", { jobType: "http_webhook" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-5",
    });
    render(<JobProperties />);
    expect(screen.getByText("HTTP Webhook Properties")).toBeTruthy();
  });

  it("renders web_automation properties for web_automation job type", () => {
    const node = makeJobNode("node-6", { jobType: "web_automation" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-6",
    });
    render(<JobProperties />);
    expect(screen.getByText("Web Automation Properties")).toBeTruthy();
  });

  it("renders mcp_tool_call properties for mcp_tool_call job type", () => {
    const node = makeJobNode("node-7", { jobType: "mcp_tool_call" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-7",
    });
    render(<JobProperties />);
    expect(screen.getByText("MCP Tool Call Properties")).toBeTruthy();
  });

  it("renders git_operation properties for git_operation job type", () => {
    const node = makeJobNode("node-8", { jobType: "git_operation" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-8",
    });
    render(<JobProperties />);
    expect(screen.getByText("Git Operation Properties")).toBeTruthy();
  });

  it("renders register_tool properties for register_tool job type", () => {
    const node = makeJobNode("node-9", { jobType: "register_tool" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-9",
    });
    render(<JobProperties />);
    expect(screen.getByText("Register Tool Properties")).toBeTruthy();
  });

  it("renders manage_tool_candidate properties for manage_tool_candidate job type", () => {
    const node = makeJobNode("node-10", { jobType: "manage_tool_candidate" });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-10",
    });
    render(<JobProperties />);
    expect(screen.getByText("Manage Tool Candidate Properties")).toBeTruthy();
  });

  it("shows Unknown job type for unrecognised jobType", () => {
    const node = makeJobNode("node-x", {
      jobType: "imaginary_type" as unknown as "execution",
    });
    useWorkflowEditorStore.setState({
      nodes: [node],
      selectedElementId: "node-x",
    });
    render(<JobProperties />);
    expect(screen.getByText("Unknown job type")).toBeTruthy();
  });

  it("does not render for a step node selected", () => {
    useWorkflowEditorStore.setState({
      nodes: [
        {
          id: "step-1",
          type: "step",
          position: { x: 0, y: 0 },
          data: {
            label: "Step",
            stepType: "agent",
            stepId: "s1",
            parentJobId: "j1",
          },
        },
      ],
      selectedElementId: "step-1",
    });
    const { container } = render(<JobProperties />);
    expect(container.firstChild).toBeNull();
  });
});
