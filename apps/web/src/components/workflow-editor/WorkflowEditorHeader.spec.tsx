import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { WorkflowEditorHeader } from "./WorkflowEditorHeader";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";

function renderHeader(
  props: Partial<{
    onSave: () => void;
    onCancel: () => void;
    isSaving: boolean;
    isEditMode: boolean;
  }> = {},
) {
  const defaultProps = {
    onSave: vi.fn(),
    onCancel: vi.fn(),
    isSaving: false,
    isEditMode: false,
    ...props,
  };
  return render(<WorkflowEditorHeader {...defaultProps} />);
}

describe("WorkflowEditorHeader", () => {
  beforeEach(() => {
    useWorkflowEditorStore.setState({
      name: "",
      active: true,
      isDirty: false,
    });
  });

  it("renders the back button", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
  });

  it("calls onCancel when back button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onCancel });

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders the name input bound to store name", () => {
    useWorkflowEditorStore.setState({ name: "My Workflow" });
    renderHeader();

    const input = screen.getByRole("textbox", {
      name: /name/i,
    }) as HTMLInputElement;
    expect(input.value).toBe("My Workflow");
  });

  it("updates store name via setMetadata on name input change", async () => {
    const user = userEvent.setup();
    renderHeader();

    const input = screen.getByRole("textbox", {
      name: /name/i,
    }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "New Name");

    expect(useWorkflowEditorStore.getState().name).toBe("New Name");
  });

  it("renders the active toggle bound to store active", () => {
    useWorkflowEditorStore.setState({ active: true });
    renderHeader();

    const toggle = screen.getByRole("checkbox", { name: /active/i });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("data-state")).toBe("checked");
  });

  it("updates store active via setMetadata when toggle is clicked", async () => {
    useWorkflowEditorStore.setState({ active: true });
    const user = userEvent.setup();
    renderHeader();

    const toggle = screen.getByRole("checkbox", { name: /active/i });
    await user.click(toggle);

    expect(useWorkflowEditorStore.getState().active).toBe(false);
  });

  it("renders the save button", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
  });

  it("calls onSave when save button is clicked", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    useWorkflowEditorStore.setState({ isDirty: true });
    renderHeader({ onSave });

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("disables save button when isDirty is false", () => {
    useWorkflowEditorStore.setState({ isDirty: false });
    renderHeader();

    const saveButton = screen.getByRole("button", {
      name: /save/i,
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("disables save button when isSaving is true", () => {
    useWorkflowEditorStore.setState({ isDirty: true });
    renderHeader({ isSaving: true });

    const saveButton = screen.getByRole("button", {
      name: /saving/i,
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("renders the cancel button", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy();
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onCancel });

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows unsaved indicator when isDirty is true", () => {
    useWorkflowEditorStore.setState({ isDirty: true });
    renderHeader();

    expect(screen.getByText("*")).toBeTruthy();
  });

  it("does not show unsaved indicator when isDirty is false", () => {
    useWorkflowEditorStore.setState({ isDirty: false });
    renderHeader();

    expect(screen.queryByText("*")).toBeNull();
  });
});
