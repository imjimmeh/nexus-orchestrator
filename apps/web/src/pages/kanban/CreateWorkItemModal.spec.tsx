import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkItem } from "@/lib/api/work-items.types";
import { CreateWorkItemModal } from "./CreateWorkItemModal";

const items = [
  { id: "epic-1", title: "Epic One", type: "epic" },
  { id: "story-1", title: "Story One", type: "story" },
  { id: "task-1", title: "Task One", type: "task" },
] as unknown as WorkItem[];

describe("CreateWorkItemModal", () => {
  it("renders form fields when open", () => {
    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Create Work Item")).toBeTruthy();
  });

  it("validates title is required", () => {
    const onSubmit = vi.fn();

    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Title is required")).toBeTruthy();
  });

  it("calls onSubmit with form data", () => {
    const onSubmit = vi.fn();

    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "My new work item" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My new work item",
        priority: "p2",
        status: "backlog",
      }),
    );
  });

  it("disables create button when isPending", () => {
    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending
        onSubmit={() => undefined}
      />,
    );

    const button = screen.getByRole("button", { name: "Creating..." });
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("resets form when modal is closed and reopened", () => {
    const { rerender } = render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "My new work item" },
    });

    rerender(
      <CreateWorkItemModal
        open={false}
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
      />,
    );

    rerender(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
      />,
    );

    const input = screen.getByPlaceholderText(
      "What needs to be done?",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("defaults type to task and submits type/parent/points fields", () => {
    const onSubmit = vi.fn();

    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={onSubmit}
        items={items}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "New task" },
    });

    fireEvent.change(screen.getByLabelText("Parent (optional)"), {
      target: { value: "story-1" },
    });
    fireEvent.change(screen.getByLabelText("Story points"), {
      target: { value: "3" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New task",
        type: "task",
        parentWorkItemId: "story-1",
        storyPoints: 3,
      }),
    );
  });

  it("only offers eligible parent candidates for the selected type", () => {
    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
        items={items}
      />,
    );

    const parentSelect =
      screen.getByLabelText<HTMLSelectElement>("Parent (optional)");
    const optionValues = Array.from(parentSelect.options).map((o) => o.value);

    // "task" (the default type) can be parented by epics and stories, but
    // never by another task (canParent("task", "task") is false).
    expect(optionValues).toContain("epic-1");
    expect(optionValues).toContain("story-1");
    expect(optionValues).not.toContain("task-1");
  });

  it("hides the points field and disables the parent picker for epics", () => {
    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={() => undefined}
        items={items}
      />,
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "epic" },
    });

    expect(screen.queryByLabelText("Story points")).toBeNull();
    expect(
      screen.getByLabelText<HTMLSelectElement>("Parent (optional)").disabled,
    ).toBe(true);
  });

  it("rejects submission when an already-selected parent becomes an illegal pairing after switching type", () => {
    const onSubmit = vi.fn();

    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={onSubmit}
        items={items}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "New story" },
    });

    // Select a story parent while type is "task" (a legal pairing)...
    fireEvent.change(screen.getByLabelText("Parent (optional)"), {
      target: { value: "story-1" },
    });
    // ...then switch the child type to "story" -- story cannot parent story.
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "story" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("A Story cannot parent a Story.")).toBeTruthy();
  });

  it("rejects an epic submitted with story points", () => {
    const onSubmit = vi.fn();

    render(
      <CreateWorkItemModal
        open
        onOpenChange={() => undefined}
        isPending={false}
        onSubmit={onSubmit}
        items={items}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "New epic" },
    });
    fireEvent.change(screen.getByLabelText("Story points"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "epic" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "epic", storyPoints: undefined }),
    );
  });
});
