import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { WorkflowProperties } from "./WorkflowProperties";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";

function renderProperties() {
  return render(<WorkflowProperties />);
}

describe("WorkflowProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  describe("no node selected state", () => {
    it("does not show 'Select a node' prompt when selectedElementId is null", () => {
      useWorkflowEditorStore.setState({ selectedElementId: null });

      renderProperties();

      expect(
        screen.queryByText("Select a node or edge to edit its properties"),
      ).toBeNull();
    });

    it("shows 'Select a node' prompt when a node or edge is selected", () => {
      useWorkflowEditorStore.setState({ selectedElementId: "node-1" });

      renderProperties();

      expect(
        screen.getByText("Select a node or edge to edit its properties"),
      ).toBeTruthy();
    });

    it("shows workflow fields when selectedElementId is null", () => {
      useWorkflowEditorStore.setState({ selectedElementId: null });

      renderProperties();

      expect(screen.getByText("General")).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
      expect(screen.getByRole("checkbox", { name: "Active" })).toBeTruthy();
    });
  });

  describe("name, description, active fields", () => {
    it("reads name from store and renders it", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        name: "My Workflow",
      });

      renderProperties();

      const input = screen.getByRole("textbox", {
        name: "Name",
      }) as HTMLInputElement;
      expect(input.value).toBe("My Workflow");
    });

    it("writes name to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });
      renderProperties();

      const input = screen.getByRole("textbox", { name: "Name" });
      await user.clear(input);
      await user.type(input, "Updated Workflow");

      expect(useWorkflowEditorStore.getState().name).toBe("Updated Workflow");
    });

    it("reads description from store and renders it", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        description: "A test workflow",
      });

      renderProperties();

      const textarea = screen.getByRole("textbox", {
        name: "Description",
      }) as HTMLTextAreaElement;
      expect(textarea.value).toBe("A test workflow");
    });

    it("writes description to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });
      renderProperties();

      const textarea = screen.getByRole("textbox", { name: "Description" });
      await user.clear(textarea);
      await user.type(textarea, "New description");

      expect(useWorkflowEditorStore.getState().description).toBe(
        "New description",
      );
    });

    it("reads active from store and renders checked state", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        active: true,
      });

      renderProperties();

      const checkbox = screen.getByRole("checkbox", { name: "Active" });
      expect(checkbox.getAttribute("data-state")).toBe("checked");
    });

    it("writes active to store when toggled", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        active: true,
      });
      renderProperties();

      await user.click(screen.getByRole("checkbox", { name: "Active" }));

      expect(useWorkflowEditorStore.getState().active).toBe(false);
    });
  });

  describe("trigger section", () => {
    it("renders trigger type selector", () => {
      useWorkflowEditorStore.setState({ selectedElementId: null });

      renderProperties();

      expect(screen.getByText("Trigger")).toBeTruthy();
    });

    it("displays the current trigger type", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        trigger: { type: "event" },
      });

      renderProperties();

      await user.click(screen.getByRole("button", { name: "Trigger" }));

      const typeSelect = screen.getByRole("combobox", { name: "Type" });
      expect(typeSelect).toBeTruthy();
      expect(typeSelect.textContent).toContain("Event");
    });

    it("updates trigger type in store on selection", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });
      renderProperties();

      await user.click(screen.getByRole("button", { name: "Trigger" }));

      const typeSelect = screen.getByRole("combobox", { name: "Type" });
      await user.click(typeSelect);

      const webhookOption = screen.getByText("Webhook");
      await user.click(webhookOption);

      const trigger = useWorkflowEditorStore.getState().trigger;
      expect(trigger?.type).toBe("webhook");
    });

    it("removes lifecycle fields when switching to a non-lifecycle trigger", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        trigger: {
          type: "lifecycle",
          phase: "ready-to-merge",
          hook: "before",
          blocking: true,
        },
      });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Type" }));
      await user.click(screen.getByText("Manual"));

      expect(useWorkflowEditorStore.getState().trigger).toEqual({
        type: "manual",
      });
    });

    it("does not offer lifecycle triggers in global mode", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });

      render(<WorkflowProperties supportsLifecycleTriggers={false} />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Type" }));

      expect(screen.queryByText("Lifecycle")).toBeNull();
    });

    it("offers lifecycle triggers in repository mode", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Type" }));

      expect(screen.getByText("Lifecycle")).toBeTruthy();
    });

    it("initializes lifecycle trigger defaults when selected", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Type" }));
      await user.click(screen.getByText("Lifecycle"));

      expect(
        screen.getByRole("combobox", { name: "Phase" }).textContent,
      ).toContain("Ready to Merge");
      expect(
        screen.getByRole("combobox", { name: "Hook" }).textContent,
      ).toContain("Before");
      expect(
        screen
          .getByRole("checkbox", { name: "Blocking" })
          .getAttribute("data-state"),
      ).toBe("checked");
      expect(useWorkflowEditorStore.getState().trigger).toEqual({
        type: "lifecycle",
        phase: "ready-to-merge",
        hook: "before",
        blocking: true,
      });
    });

    it("updates lifecycle trigger fields", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        trigger: {
          type: "lifecycle",
          phase: "ready-to-merge",
          hook: "before",
          blocking: true,
        },
      });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Phase" }));
      await user.click(screen.getByText("In Review"));
      await user.click(screen.getByRole("combobox", { name: "Hook" }));
      await user.click(screen.getByText("After"));
      await user.click(screen.getByRole("checkbox", { name: "Blocking" }));

      expect(useWorkflowEditorStore.getState().trigger).toEqual({
        type: "lifecycle",
        phase: "in-review",
        hook: "after",
        blocking: false,
      });
    });

    it("does not materialize blocking true for existing after hooks", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        trigger: {
          type: "lifecycle",
          phase: "ready-to-merge",
          hook: "after",
        },
      });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      expect(
        screen
          .getByRole("checkbox", { name: "Blocking" })
          .getAttribute("data-state"),
      ).toBe("unchecked");

      await user.click(screen.getByRole("combobox", { name: "Phase" }));
      await user.click(screen.getByText("In Review"));

      expect(useWorkflowEditorStore.getState().trigger).toEqual({
        type: "lifecycle",
        phase: "in-review",
        hook: "after",
      });
    });

    it("preserves and edits unknown lifecycle phases", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        trigger: {
          type: "lifecycle",
          phase: "security-review",
          hook: "before",
          blocking: true,
        },
      });

      render(<WorkflowProperties supportsLifecycleTriggers />);

      await user.click(screen.getByRole("button", { name: "Trigger" }));

      const customPhaseInput = screen.getByRole("textbox", {
        name: "Custom Phase",
      });
      expect((customPhaseInput as HTMLInputElement).value).toBe(
        "security-review",
      );

      await user.clear(customPhaseInput);
      await user.type(customPhaseInput, "post-review");

      expect(useWorkflowEditorStore.getState().trigger).toEqual({
        type: "lifecycle",
        phase: "post-review",
        hook: "before",
        blocking: true,
      });
    });
  });

  describe("concurrency section", () => {
    it("renders concurrency fields", () => {
      useWorkflowEditorStore.setState({ selectedElementId: null });

      renderProperties();

      expect(screen.getByText("Concurrency")).toBeTruthy();
    });

    it("displays current concurrency values", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        concurrency: { max_runs: 5, scope: "workflow", on_conflict: "queue" },
      });

      renderProperties();

      await user.click(screen.getByRole("button", { name: "Concurrency" }));

      const maxRunsInput = screen.getByRole("spinbutton", { name: "Max Runs" });
      expect((maxRunsInput as HTMLInputElement).value).toBe("5");

      const scopeSelect = screen.getByRole("combobox", { name: "Scope" });
      expect(scopeSelect.textContent).toContain("Workflow");

      const conflictSelect = screen.getByRole("combobox", {
        name: "On Conflict",
      });
      expect(conflictSelect.textContent).toContain("Queue");
    });

    it("updates concurrency max_runs in store", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        concurrency: { max_runs: 5, scope: "workflow", on_conflict: "queue" },
      });
      renderProperties();

      await user.click(screen.getByRole("button", { name: "Concurrency" }));

      const maxRunsInput = screen.getByRole("spinbutton", {
        name: "Max Runs",
      });
      await user.clear(maxRunsInput);
      await user.type(maxRunsInput, "10");

      const concurrency = useWorkflowEditorStore.getState().concurrency;
      expect(concurrency?.max_runs).toBe(10);
    });
  });

  describe("collapsible sections", () => {
    it("shows section content when expand button is clicked", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({ selectedElementId: null });
      renderProperties();

      const triggerButton = screen.getByRole("button", { name: "Trigger" });
      await user.click(triggerButton);

      expect(screen.getByRole("combobox", { name: "Type" })).toBeTruthy();
    });
  });
});
