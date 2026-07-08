import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { StoryPointChip } from "./story-point-chip";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Test work item",
    description: null,
    status: "in-progress",
    type: "task",
    priority: "p2",
    storyPoints: null,
    rolledUpPoints: null,
    hasChildren: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("StoryPointChip", () => {
  it("renders its own story points for a leaf work item (task)", () => {
    const item = makeWorkItem({ type: "task", storyPoints: 5 });
    render(<StoryPointChip item={item} onChange={vi.fn()} />);

    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders a static badge in read-only mode for a leaf with points", () => {
    const item = makeWorkItem({ type: "task", storyPoints: 5 });
    render(<StoryPointChip item={item} readOnly />);

    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders a placeholder in read-only mode for a leaf without points", () => {
    const item = makeWorkItem({ type: "story", storyPoints: null });
    render(<StoryPointChip item={item} readOnly />);

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders rolled-up points in read-only mode for a container story with children", () => {
    const item = makeWorkItem({
      type: "story",
      storyPoints: 3,
      hasChildren: true,
      rolledUpPoints: 8,
    });
    render(<StoryPointChip item={item} readOnly />);

    expect(screen.getByText("8")).toBeTruthy();
  });

  it("renders rolled-up points read-only for an epic and shows no edit picker", () => {
    const item = makeWorkItem({
      type: "epic",
      storyPoints: null,
      rolledUpPoints: 21,
    });
    render(<StoryPointChip item={item} onChange={vi.fn()} />);

    expect(screen.getByText("21")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a placeholder rollup of 0 for an epic with no rolled-up points yet", () => {
    const item = makeWorkItem({
      type: "epic",
      storyPoints: null,
      rolledUpPoints: null,
    });
    render(<StoryPointChip item={item} onChange={vi.fn()} />);

    expect(screen.getByText("0")).toBeTruthy();
  });

  it("restricts the edit picker to Fibonacci values when editing a leaf item", () => {
    const item = makeWorkItem({ type: "story", storyPoints: 3 });
    render(<StoryPointChip item={item} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const optionValues = Array.from(select.options)
      .map((option) => option.value)
      .filter((value) => value !== "");

    expect(optionValues).toEqual(["1", "2", "3", "5", "8", "13"]);
  });

  it("calls onChange with the selected Fibonacci value and closes the picker", () => {
    const onChange = vi.fn();
    const item = makeWorkItem({ type: "story", storyPoints: 3 });
    render(<StoryPointChip item={item} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "8" },
    });

    expect(onChange).toHaveBeenCalledWith(8);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
