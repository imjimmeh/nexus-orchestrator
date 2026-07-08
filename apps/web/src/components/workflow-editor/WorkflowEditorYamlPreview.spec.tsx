import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkflowEditorYamlPreview } from "./WorkflowEditorYamlPreview";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";

vi.mock("@/components/workflow/YamlEditor", () => ({
  YamlEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string | undefined) => void;
    readOnly?: boolean;
    height?: string;
  }) => (
    <pre
      data-testid="yaml-editor"
      data-has-on-change={Boolean(onChange)}
      data-readonly={readOnly}
    >
      {value}
    </pre>
  ),
}));

describe("WorkflowEditorYamlPreview", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("does not render when isVisible is false", () => {
    render(<WorkflowEditorYamlPreview isVisible={false} />);
    expect(screen.queryByText("YAML Preview")).toBeNull();
  });

  it("renders panel header when isVisible is true", () => {
    render(<WorkflowEditorYamlPreview isVisible={true} />);
    expect(screen.getByText("YAML Preview")).toBeTruthy();
  });

  it("renders serialized YAML from store data", () => {
    useWorkflowEditorStore.setState({
      name: "Test Workflow",
      nodes: [],
      edges: [],
    });

    render(<WorkflowEditorYamlPreview isVisible={true} />);

    const editorEl = screen.getByTestId("yaml-editor");
    expect(editorEl).toBeTruthy();
    expect(editorEl.textContent).toContain("name:");
  });

  it("renders the YAML editor as editable when visible", () => {
    useWorkflowEditorStore.setState({
      nodes: [],
      edges: [],
    });

    render(<WorkflowEditorYamlPreview isVisible={true} />);

    const editorEl = screen.getByTestId("yaml-editor");
    expect(editorEl.getAttribute("data-readonly")).toBe("false");
    expect(editorEl.getAttribute("data-has-on-change")).toBe("true");
  });

  it("collapses and expands via toggle button", async () => {
    useWorkflowEditorStore.setState({
      nodes: [],
      edges: [],
    });

    render(<WorkflowEditorYamlPreview isVisible={true} />);

    const expandedButton = screen.getByRole("button", {
      name: "Toggle YAML Preview",
    });

    expect(screen.getByTestId("yaml-editor")).toBeTruthy();

    fireEvent.click(expandedButton);

    expect(screen.queryByTestId("yaml-editor")).toBeNull();
    expect(screen.getByText("YAML Preview")).toBeTruthy();

    const collapsedButton = screen.getByRole("button", {
      name: "Toggle YAML Preview",
    });
    fireEvent.click(collapsedButton);

    expect(await screen.findByTestId("yaml-editor")).toBeTruthy();
  });

  it("shows YAML panel header even when collapsed", () => {
    useWorkflowEditorStore.setState({
      nodes: [],
      edges: [],
    });

    render(<WorkflowEditorYamlPreview isVisible={true} />);

    const toggleButton = screen.getByRole("button", {
      name: "Toggle YAML Preview",
    });
    fireEvent.click(toggleButton);

    expect(screen.getByText("YAML Preview")).toBeTruthy();
    expect(screen.queryByTestId("yaml-editor")).toBeNull();
  });

  it("serializes current graph state whenever is visible", () => {
    useWorkflowEditorStore.setState({
      name: "Visible",
      nodes: [],
      edges: [],
    });

    const { rerender } = render(
      <WorkflowEditorYamlPreview isVisible={false} />,
    );

    expect(screen.queryByTestId("yaml-editor")).toBeNull();

    rerender(<WorkflowEditorYamlPreview isVisible={true} />);

    expect(screen.getByTestId("yaml-editor")).toBeTruthy();
    expect(screen.getByTestId("yaml-editor").textContent).toContain("name:");
  });
});
