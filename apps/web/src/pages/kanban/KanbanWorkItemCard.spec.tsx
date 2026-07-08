import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { KanbanWorkItemCard } from "./KanbanWorkItemCard";

const mockProvided = {
  innerRef: vi.fn(),
  draggableProps: {
    "data-draggable": "true",
  },
  dragHandleProps: {
    "data-drag-handle": "true",
  },
};

vi.mock("@hello-pangea/dnd", () => ({
  Draggable: ({
    children,
  }: {
    children: (provided: typeof mockProvided) => ReactNode;
  }) => children(mockProvided),
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-item-1",
    project_id: "project-1",
    title: "Sample work item",
    description: "Investigate card interactions",
    status: "todo",
    type: "story",
    priority: "p2",
    storyPoints: null,
    rolledUpPoints: null,
    hasChildren: false,
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<ComponentProps<typeof KanbanWorkItemCard>> = {},
) {
  const props: ComponentProps<typeof KanbanWorkItemCard> = {
    item: makeWorkItem(),
    index: 0,
    detailItemId: null,
    failedItemId: null,
    onSelect: vi.fn(),
    onConfigure: vi.fn(),
    onMoveToStatus: vi.fn(),
    onRetriggerExecution: vi.fn(),
    onDeleteItem: vi.fn(),
    isStatusUpdatePending: false,
    ...overrides,
  };

  return { ...render(<KanbanWorkItemCard {...props} />), props };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("KanbanWorkItemCard", () => {
  it("displays the story points on the card", () => {
    renderCard({
      item: makeWorkItem({ type: "task", storyPoints: 5 }),
    });

    expect(screen.getByText("5")).toBeTruthy();
  });
  it("opens work item details from the full-card click target", () => {
    const { props } = renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: "Open details for Sample work item" }),
    );

    expect(props.onSelect).toHaveBeenCalledWith("work-item-1");
  });

  it("opens the custom context menu when right-clicking visible card content", () => {
    renderCard();

    fireEvent.contextMenu(screen.getByText("Sample work item"));

    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Move to" })).toBeTruthy();
  });

  it("maps the In Progress menu option to in-progress status", () => {
    const { props } = renderCard();

    fireEvent.contextMenu(screen.getByText("Sample work item"));
    fireEvent.click(screen.getByRole("menuitem", { name: "In Progress" }));

    expect(props.onMoveToStatus).toHaveBeenCalledWith(
      "work-item-1",
      "in-progress",
    );
  });

  it("retriggers execution from the context menu for a restartable item", () => {
    const item = makeWorkItem({ status: "in-progress" });
    const { props } = renderCard({ item });

    fireEvent.contextMenu(screen.getByText("Sample work item"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Retrigger Execution" }),
    );

    expect(props.onRetriggerExecution).toHaveBeenCalledWith(item);
  });

  it("hides the retrigger option for a non-restartable item", () => {
    renderCard({ item: makeWorkItem({ status: "backlog" }) });

    fireEvent.contextMenu(screen.getByText("Sample work item"));

    expect(
      screen.queryByRole("menuitem", { name: "Retrigger Execution" }),
    ).toBeNull();
  });

  it("requests deletion from the context menu", () => {
    const item = makeWorkItem();
    const { props } = renderCard({ item });

    fireEvent.contextMenu(screen.getByText("Sample work item"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(props.onDeleteItem).toHaveBeenCalledWith(item);
  });

  it("keeps configure independent from the full-card click target", () => {
    const { props } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));

    expect(props.onConfigure).toHaveBeenCalledWith("work-item-1");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("marks the visible card body as pointer-transparent so the overlay receives clicks", () => {
    const { container } = renderCard();

    expect(container.querySelector(".pointer-events-none")).toBeTruthy();
    expect(container.querySelector(".pointer-events-auto")).toBeTruthy();
  });

  it("places the drag handle props on the full-card overlay target", () => {
    renderCard();

    const detailButton = screen.getByRole("button", {
      name: "Open details for Sample work item",
    });

    expect(detailButton.dataset.dragHandle).toBe("true");
  });

  describe("human decision policy metadata", () => {
    it("renders feedback needed label and decision prompt when metadata indicates feedback is required", () => {
      renderCard({
        item: makeWorkItem({
          metadata: {
            feedbackNeeded: true,
            decisionPrompt: "Should this existing behavior be preserved?",
            humanDecisionPolicy: "ask_when_uncertain",
          },
        }),
      });

      expect(screen.getByText("Feedback needed")).toBeTruthy();
      expect(
        screen.getByText("Should this existing behavior be preserved?"),
      ).toBeTruthy();
    });

    it("renders autonomous decision label and rationale when metadata indicates an autonomous resolution", () => {
      renderCard({
        item: makeWorkItem({
          metadata: {
            autonomousDecision: true,
            resolutionRationale:
              "Autonomous mode converted this finding into actionable work.",
            humanDecisionPolicy: "decide_without_approval",
          },
        }),
      });

      expect(screen.getByText("Autonomous decision")).toBeTruthy();
      expect(
        screen.getByText(
          "Autonomous mode converted this finding into actionable work.",
        ),
      ).toBeTruthy();
    });

    it("renders generated recommendation and status-preserved notice when a user override is present", () => {
      renderCard({
        item: makeWorkItem({
          status: "todo",
          metadata: {
            userStatusOverride: true,
            generatedRecommendation: "blocked",
            currentDisposition: "todo",
            lastGeneratedStatus: "blocked",
          },
        }),
      });

      expect(
        screen.getByText("Generated recommendation: blocked"),
      ).toBeTruthy();
      expect(screen.getByText("Your current status is preserved")).toBeTruthy();
    });
  });
});
