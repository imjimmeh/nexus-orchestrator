import { describe, it, expect, vi, beforeEach } from "vitest";
import { BoardStateService } from "../board-state.service";
import { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";

const mockBoardStateRepository = {
  findLatestByProjectIdAndIdempotencyKeyPrefix: vi.fn(),
  findLatestByProjectId: vi.fn(),
  save: vi.fn(),
};

const mockProjects = {
  findById: vi.fn(),
};

const mockWorkItems = {
  findAll: vi.fn(),
  findByproject_id: vi.fn(),
};

const mockGoals = {
  findByproject_id: vi.fn(),
};

function makeWorkItem(
  project_id: string,
  status: string,
): Partial<KanbanWorkItemEntity> {
  return { project_id, status };
}

describe("BoardStateService.getBoardStateSummary", () => {
  let service: BoardStateService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BoardStateService(
      mockBoardStateRepository as never,
      mockProjects as never,
      mockWorkItems as never,
      mockGoals as never,
    );
    mockGoals.findByproject_id.mockResolvedValue([]);
  });

  it("returns counts from work items filtered by project", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([
      makeWorkItem("proj-1", "todo"),
      makeWorkItem("proj-1", "in-progress"),
      makeWorkItem("proj-1", "in-progress"),
      makeWorkItem("proj-1", "done"),
      makeWorkItem("proj-1", "blocked"),
    ]);

    const result = await service.getBoardStateSummary("proj-1");

    expect(result.projectId).toBe("proj-1");
    expect(result.totalTasks).toBe(5);
    expect(result.completedTasks).toBe(1);
    expect(result.inProgressTasks).toBe(2);
    expect(result.blockedTasks).toBe(1);
    expect(result.pendingTasks).toBe(1);
  });

  it("returns zeros for an empty project", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([]);

    const result = await service.getBoardStateSummary("proj-empty");

    expect(result.totalTasks).toBe(0);
    expect(result.completedTasks).toBe(0);
    expect(result.inProgressTasks).toBe(0);
    expect(result.blockedTasks).toBe(0);
    expect(result.pendingTasks).toBe(0);
  });

  it("includes backlog items in pendingTasks", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([
      makeWorkItem("proj-2", "todo"),
      makeWorkItem("proj-2", "backlog"),
      makeWorkItem("proj-2", "backlog"),
    ]);

    const result = await service.getBoardStateSummary("proj-2");

    expect(result.totalTasks).toBe(3);
    expect(result.pendingTasks).toBe(3);
    expect(result.completedTasks).toBe(0);
  });

  it("sets lastActivityAt to the most recent updated_at across project work items", async () => {
    const earlier = new Date("2024-01-01T00:00:00Z");
    const later = new Date("2024-06-15T12:00:00Z");

    mockWorkItems.findByproject_id.mockResolvedValue([
      { ...makeWorkItem("proj-3", "todo"), updated_at: earlier },
      { ...makeWorkItem("proj-3", "done"), updated_at: later },
    ]);

    const result = await service.getBoardStateSummary("proj-3");

    expect(result.lastActivityAt).toEqual(later);
  });

  it("returns lastActivityAt as null when project has no work items", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([]);

    const result = await service.getBoardStateSummary("proj-none");

    expect(result.lastActivityAt).toBeNull();
  });
});

describe("BoardStateService.getBoardStateSummary — work_item_counts and goal_coverage (M4 contract)", () => {
  let service: BoardStateService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BoardStateService(
      mockBoardStateRepository as never,
      mockProjects as never,
      mockWorkItems as never,
      mockGoals as never,
    );
  });

  it("populates work_item_counts with terminal and active buckets", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([
      makeWorkItem("proj-mix", "done"),
      makeWorkItem("proj-mix", "done"),
      makeWorkItem("proj-mix", "completed"),
      makeWorkItem("proj-mix", "in-progress"),
      makeWorkItem("proj-mix", "blocked"),
    ]);
    mockGoals.findByproject_id.mockResolvedValueOnce([]);

    const result = await service.getBoardStateSummary("proj-mix");

    expect(result.work_item_counts).toBeDefined();
    expect(result.work_item_counts?.total).toBe(5);
    expect(result.work_item_counts?.doneCount).toBe(3);
    expect(result.work_item_counts?.activeCount).toBe(2);
    expect(result.total_items).toBe(5);
    expect(result.column_counts).toEqual(result.work_item_counts?.byStatus);
  });

  it("populates goal_coverage from non-archived goals", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([]);
    mockGoals.findByproject_id.mockResolvedValueOnce([
      { status: "done" },
      { status: "in-progress" },
      { status: "todo" },
      { status: "refinement" },
    ]);

    const result = await service.getBoardStateSummary("proj-goals");

    expect(result.goal_coverage).toBeDefined();
    expect(result.goal_coverage?.total).toBe(4);
    expect(result.goal_coverage?.completed).toBe(1);
    expect(result.goal_coverage?.active).toBe(3);
    expect(result.goal_coverage?.coveragePercentage).toBe(25);
  });

  it("returns zero goal_coverage when project has no goals (divide-by-zero fallback)", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([
      makeWorkItem("proj-empty-goals", "todo"),
    ]);
    mockGoals.findByproject_id.mockResolvedValueOnce([]);

    const result = await service.getBoardStateSummary("proj-empty-goals");

    expect(result.goal_coverage?.total).toBe(0);
    expect(result.goal_coverage?.completed).toBe(0);
    expect(result.goal_coverage?.active).toBe(0);
    expect(result.goal_coverage?.coveragePercentage).toBe(0);
    expect(
      Number.isFinite(result.goal_coverage?.coveragePercentage ?? NaN),
    ).toBe(true);
  });

  it("returns zero counts for an empty project", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([]);
    mockGoals.findByproject_id.mockResolvedValueOnce([]);

    const result = await service.getBoardStateSummary("proj-empty");

    expect(result.totalTasks).toBe(0);
    expect(result.completedTasks).toBe(0);
    expect(result.blockedTasks).toBe(0);
    expect(result.inProgressTasks).toBe(0);
    expect(result.pendingTasks).toBe(0);
    expect(result.work_item_counts?.total).toBe(0);
    expect(result.work_item_counts?.doneCount).toBe(0);
    expect(result.work_item_counts?.activeCount).toBe(0);
    expect(result.goal_coverage?.total).toBe(0);
    expect(result.goal_coverage?.completed).toBe(0);
    expect(result.goal_coverage?.coveragePercentage).toBe(0);
  });

  it("computes 100% coverage when all goals are completed", async () => {
    mockWorkItems.findByproject_id.mockResolvedValue([]);
    mockGoals.findByproject_id.mockResolvedValueOnce([
      { status: "done" },
      { status: "done" },
      { status: "done" },
    ]);

    const result = await service.getBoardStateSummary("proj-all-done");

    expect(result.goal_coverage?.total).toBe(3);
    expect(result.goal_coverage?.completed).toBe(3);
    expect(result.goal_coverage?.active).toBe(0);
    expect(result.goal_coverage?.coveragePercentage).toBe(100);
  });
});
