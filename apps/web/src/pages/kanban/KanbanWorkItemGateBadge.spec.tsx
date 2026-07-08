import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanWorkItemGateBadge } from "./KanbanWorkItemGateBadge";
import { WorkItem } from "@/lib/api/work-items.types";

const item = (gate?: unknown) =>
  ({
    id: "w1",
    status: "in-review",
    metadata: gate ? { lifecycle: { gate } } : null,
  }) as unknown as WorkItem;

describe("KanbanWorkItemGateBadge", () => {
  it("renders nothing in the 'none' state", () => {
    const { container } = render(
      <KanbanWorkItemGateBadge item={item()} gateState="none" />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("shows a running label", () => {
    render(<KanbanWorkItemGateBadge item={item()} gateState="running" />);
    expect(screen.getByText(/entering/i)).toBeTruthy();
  });
  it("shows held with the failing target", () => {
    render(
      <KanbanWorkItemGateBadge
        item={item({
          status: "held",
          targetStatus: "ready-to-merge",
          failures: [{ workflowName: "e2e", status: "failed" }],
        })}
        gateState="held"
      />,
    );
    expect(screen.getByText(/held at gate/i)).toBeTruthy();
  });
});
