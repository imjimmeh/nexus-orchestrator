import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import { FlatKanbanView } from "./KanbanColumnsView";

const mockDroppableProvided = {
  innerRef: vi.fn(),
  droppableProps: {
    "data-droppable": "true",
  },
  placeholder: null,
};

const mockDraggableProvided = {
  innerRef: vi.fn(),
  draggableProps: {
    "data-draggable": "true",
  },
  dragHandleProps: {
    "data-drag-handle": "true",
  },
};

vi.mock("@hello-pangea/dnd", () => ({
  Droppable: ({
    children,
  }: {
    children: (
      provided: typeof mockDroppableProvided,
      snapshot: { isDraggingOver: boolean },
    ) => ReactNode;
  }) => children(mockDroppableProvided, { isDraggingOver: false }),
  Draggable: ({
    children,
  }: {
    children: (provided: typeof mockDraggableProvided) => ReactNode;
  }) => children(mockDraggableProvided),
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Work item",
    description: null,
    status: "backlog",
    type: "task",
    priority: "p2",
    parentWorkItemId: null,
    storyPoints: null,
    rolledUpPoints: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

const baseProps = {
  projectId: "project-1",
  grouped: {
    backlog: [],
    refinement: [],
    todo: [],
    "in-progress": [],
    "in-review": [],
    "ready-to-merge": [],
    "awaiting-pr-merge": [],
    blocked: [],
    done: [],
  } satisfies Record<WorkItem["status"], WorkItem[]>,
  allItems: [],
  automationStatuses: [],
  collapsedColumns: {
    backlog: false,
    refinement: false,
    todo: false,
    "in-progress": false,
    "in-review": false,
    "ready-to-merge": false,
    "awaiting-pr-merge": false,
    blocked: false,
    done: false,
  },
  detailItemId: null,
  failedItemId: null,
  isStatusUpdatePending: false,
  isCreatingWorkItem: false,
  onCreateWorkItem: () => undefined,
  onSelectDetailItem: () => undefined,
  onConfigureItem: () => undefined,
  onMoveItemToStatus: () => undefined,
  onRetriggerItemExecution: () => undefined,
  onDeleteItem: () => undefined,
  onToggleColumn: () => undefined,
  toDroppableId: (scope: string, status: string) => `${scope}-${status}`,
};

describe("FlatKanbanView", () => {
  it("renders all kanban columns", () => {
    render(<FlatKanbanView {...baseProps} />);

    expect(screen.getByText("Backlog")).toBeTruthy();
    expect(screen.getByText("Refinement")).toBeTruthy();
    expect(screen.getByText("To Do")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("In Review")).toBeTruthy();
    expect(screen.getByText("Ready to Merge")).toBeTruthy();
    expect(screen.getByText("Awaiting PR Merge")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("does not constrain the board with an internal horizontal scrollbar", () => {
    const { container } = render(<FlatKanbanView {...baseProps} />);

    const boardContainer = container.firstElementChild;
    expect(boardContainer).toBeTruthy();
    expect(boardContainer?.classList.contains("overflow-x-auto")).toBe(false);
    expect(boardContainer?.classList.contains("min-w-full")).toBe(true);
  });
});

describe("FlatKanbanView epic/story hierarchy", () => {
  const epic = makeWorkItem({
    id: "epic-1",
    title: "Parent epic",
    type: "epic",
    rolledUpPoints: 8,
  });
  const storyA = makeWorkItem({
    id: "story-a",
    title: "Child story A",
    type: "story",
    parentWorkItemId: "epic-1",
    storyPoints: 3,
  });
  const storyB = makeWorkItem({
    id: "story-b",
    title: "Child story B",
    type: "story",
    parentWorkItemId: "epic-1",
    storyPoints: 5,
  });

  function renderWithHierarchy() {
    return render(
      <FlatKanbanView
        {...baseProps}
        grouped={{
          ...baseProps.grouped,
          backlog: [epic, storyA, storyB],
        }}
        allItems={[epic, storyA, storyB]}
      />,
    );
  }

  it("nests children under their parent and shows the rolled-up points", () => {
    renderWithHierarchy();

    expect(screen.getByText("Parent epic")).toBeTruthy();
    expect(screen.getByText("Child story A")).toBeTruthy();
    expect(screen.getByText("Child story B")).toBeTruthy();
    expect(screen.getByText("8 pts")).toBeTruthy();
    expect(screen.getByText("2 sub-items")).toBeTruthy();
  });

  it("collapses children when the toggle is clicked, while the rollup stays visible", () => {
    renderWithHierarchy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Parent epic" }),
    );

    expect(screen.queryByText("Child story A")).toBeNull();
    expect(screen.queryByText("Child story B")).toBeNull();
    expect(screen.getByText("8 pts")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand Parent epic" }),
    ).toBeTruthy();
  });

  it("expands children again when the toggle is clicked a second time", () => {
    renderWithHierarchy();

    const toggle = screen.getByRole("button", { name: "Collapse Parent epic" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Expand Parent epic" }));

    expect(screen.getByText("Child story A")).toBeTruthy();
    expect(screen.getByText("Child story B")).toBeTruthy();
  });

  it("does not render a hierarchy toggle for a leaf item with no children", () => {
    render(
      <FlatKanbanView
        {...baseProps}
        grouped={{
          ...baseProps.grouped,
          backlog: [makeWorkItem({ id: "leaf-1", title: "Leaf task" })],
        }}
        allItems={[makeWorkItem({ id: "leaf-1", title: "Leaf task" })]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Collapse|Expand/ }),
    ).toBeNull();
  });
});

describe("FlatKanbanView multi-level hierarchy (Bug 1)", () => {
  const epic = makeWorkItem({
    id: "epic-1",
    title: "Grand epic",
    type: "epic",
    rolledUpPoints: 8,
  });
  const story = makeWorkItem({
    id: "story-1",
    title: "Mid story",
    type: "story",
    parentWorkItemId: "epic-1",
    rolledUpPoints: 3,
  });
  const task = makeWorkItem({
    id: "task-1",
    title: "Leaf task",
    type: "task",
    parentWorkItemId: "story-1",
  });

  function renderThreeGenerations() {
    return render(
      <FlatKanbanView
        {...baseProps}
        grouped={{
          ...baseProps.grouped,
          backlog: [epic, story, task],
        }}
        allItems={[epic, story, task]}
      />,
    );
  }

  it("renders a grandchild nested under its parent story, which is nested under the epic", () => {
    renderThreeGenerations();

    expect(screen.getByText("Grand epic")).toBeTruthy();
    expect(screen.getByText("Mid story")).toBeTruthy();
    expect(screen.getByText("Leaf task")).toBeTruthy();
  });

  it("collapsing the epic hides both the story and the deeply nested task", () => {
    renderThreeGenerations();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Grand epic" }),
    );

    expect(screen.queryByText("Mid story")).toBeNull();
    expect(screen.queryByText("Leaf task")).toBeNull();
  });
});

describe("FlatKanbanView rollup badge decoupled from same-column children (Bug 2)", () => {
  it("shows the rollup number without a toggle when the item's children all live in a different column", () => {
    const epicWithRemoteChildren = makeWorkItem({
      id: "epic-remote",
      title: "Epic with remote children",
      type: "epic",
      hasChildren: true,
      rolledUpPoints: 8,
    });

    render(
      <FlatKanbanView
        {...baseProps}
        grouped={{
          ...baseProps.grouped,
          backlog: [epicWithRemoteChildren],
        }}
        allItems={[epicWithRemoteChildren]}
      />,
    );

    expect(screen.getByText("Epic with remote children")).toBeTruthy();
    expect(screen.getByText("8 pts")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Collapse|Expand/ }),
    ).toBeNull();
  });
});

describe("FlatKanbanView toggle visible without rollup derived fields (Bug 3)", () => {
  it("shows the toggle and sub-item count for same-column children even when hasChildren/rolledUpPoints are unset, without a points badge", () => {
    const epicWithoutDerivedFields = makeWorkItem({
      id: "epic-undecorated",
      title: "Epic without derived rollup",
      type: "epic",
    });
    const childStory = makeWorkItem({
      id: "story-undecorated",
      title: "Child of undecorated epic",
      type: "story",
      parentWorkItemId: "epic-undecorated",
    });

    render(
      <FlatKanbanView
        {...baseProps}
        grouped={{
          ...baseProps.grouped,
          backlog: [epicWithoutDerivedFields, childStory],
        }}
        allItems={[epicWithoutDerivedFields, childStory]}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Collapse Epic without derived rollup",
      }),
    ).toBeTruthy();
    expect(screen.getByText("1 sub-item")).toBeTruthy();
    expect(screen.queryByText("0 pts")).toBeNull();
  });
});
