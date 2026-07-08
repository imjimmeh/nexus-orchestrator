import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkItemType } from "@nexus/kanban-contracts";
import { WorkItemTypeBadge } from "./work-item-type-badge";

describe("WorkItemTypeBadge", () => {
  it("renders 'Epic' with the epic color class for type='epic'", () => {
    const type: WorkItemType = "epic";
    render(<WorkItemTypeBadge type={type} />);

    const badge = screen.getByText("Epic");
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass("bg-purple-100");
    expect(badge).toHaveClass("text-purple-700");
  });

  it("renders 'Story' with the story color class for type='story'", () => {
    const type: WorkItemType = "story";
    render(<WorkItemTypeBadge type={type} />);

    const badge = screen.getByText("Story");
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass("bg-blue-100");
    expect(badge).toHaveClass("text-blue-700");
  });

  it("renders 'Task' with the task color class for type='task'", () => {
    const type: WorkItemType = "task";
    render(<WorkItemTypeBadge type={type} />);

    const badge = screen.getByText("Task");
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass("bg-green-100");
    expect(badge).toHaveClass("text-green-700");
  });

  it("renders 'Bug' with the bug color class for type='bug'", () => {
    const type: WorkItemType = "bug";
    render(<WorkItemTypeBadge type={type} />);

    const badge = screen.getByText("Bug");
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass("bg-red-100");
    expect(badge).toHaveClass("text-red-700");
  });

  it("renders 'Spike' with the spike color class for type='spike'", () => {
    const type: WorkItemType = "spike";
    render(<WorkItemTypeBadge type={type} />);

    const badge = screen.getByText("Spike");
    expect(badge).toBeTruthy();
    expect(badge).toHaveClass("bg-amber-100");
    expect(badge).toHaveClass("text-amber-700");
  });
});
