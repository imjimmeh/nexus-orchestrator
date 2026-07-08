import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkItemTypeFields } from "./WorkItemEditSections";

const allItems = [
  { id: "current", title: "Current Item", type: "task" },
  { id: "epic-1", title: "Epic One", type: "epic" },
  { id: "story-1", title: "Story One", type: "story" },
  { id: "task-1", title: "Task One", type: "task" },
] as unknown as WorkItem[];

describe("WorkItemTypeFields", () => {
  it("excludes the current item and ineligible types from the parent picker", () => {
    render(
      <WorkItemTypeFields
        currentItemId="current"
        allItems={allItems}
        type="task"
        parentWorkItemId={null}
        storyPoints={null}
        errors={{}}
        onTypeChange={vi.fn()}
        onParentWorkItemIdChange={vi.fn()}
        onStoryPointsChange={vi.fn()}
      />,
    );

    const parentSelect =
      screen.getByLabelText<HTMLSelectElement>("Parent (optional)");
    const optionValues = Array.from(parentSelect.options).map((o) => o.value);

    expect(optionValues).toContain("epic-1");
    expect(optionValues).toContain("story-1");
    expect(optionValues).not.toContain("task-1");
    expect(optionValues).not.toContain("current");
  });

  it("hides the points field and disables the parent picker when converting to epic", () => {
    const onTypeChange = vi.fn();
    const onParentWorkItemIdChange = vi.fn();
    const onStoryPointsChange = vi.fn();

    const { rerender } = render(
      <WorkItemTypeFields
        currentItemId="current"
        allItems={allItems}
        type="task"
        parentWorkItemId="story-1"
        storyPoints={3}
        errors={{}}
        onTypeChange={onTypeChange}
        onParentWorkItemIdChange={onParentWorkItemIdChange}
        onStoryPointsChange={onStoryPointsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "epic" },
    });

    expect(onTypeChange).toHaveBeenCalledWith("epic");
    expect(onParentWorkItemIdChange).toHaveBeenCalledWith(null);
    expect(onStoryPointsChange).toHaveBeenCalledWith(null);

    rerender(
      <WorkItemTypeFields
        currentItemId="current"
        allItems={allItems}
        type="epic"
        parentWorkItemId={null}
        storyPoints={null}
        errors={{}}
        onTypeChange={onTypeChange}
        onParentWorkItemIdChange={onParentWorkItemIdChange}
        onStoryPointsChange={onStoryPointsChange}
      />,
    );

    expect(screen.queryByLabelText("Story points")).toBeNull();
    expect(
      screen.getByLabelText<HTMLSelectElement>("Parent (optional)").disabled,
    ).toBe(true);
  });

  it("surfaces field-level errors", () => {
    render(
      <WorkItemTypeFields
        currentItemId="current"
        allItems={allItems}
        type="story"
        parentWorkItemId="story-1"
        storyPoints={null}
        errors={{ parentWorkItemId: "A Story cannot parent a Story." }}
        onTypeChange={vi.fn()}
        onParentWorkItemIdChange={vi.fn()}
        onStoryPointsChange={vi.fn()}
      />,
    );

    expect(screen.getByText("A Story cannot parent a Story.")).toBeTruthy();
  });
});
