import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanProjectGoalRepository } from "../database/repositories/kanban-project-goal.repository";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";
import { ProjectGoalsService } from "./project-goals.service";

describe("ProjectGoalsService", () => {
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findByproject_id: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    reorder: ReturnType<typeof vi.fn>;
    setArchived: ReturnType<typeof vi.fn>;
    listWorklogs: ReturnType<typeof vi.fn>;
    createWorklog: ReturnType<typeof vi.fn>;
  };
  let workItems: {
    findByProjectAndId: ReturnType<typeof vi.fn>;
  };
  let enqueuerStub: { enqueue: ReturnType<typeof vi.fn> };
  let service: ProjectGoalsService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findByproject_id: vi.fn(),
      findById: vi.fn(),
      save: vi.fn(),
      reorder: vi.fn(),
      setArchived: vi.fn(),
      listWorklogs: vi.fn(),
      createWorklog: vi.fn(),
    };
    workItems = {
      findByProjectAndId: vi.fn(),
    };
    enqueuerStub = { enqueue: vi.fn().mockResolvedValue(undefined) };
    service = new ProjectGoalsService(
      repository as unknown as KanbanProjectGoalRepository,
      workItems as unknown as KanbanWorkItemRepository,
      enqueuerStub as unknown as CharterRegenEnqueuer,
    );
  });

  it("creates and lists goals from kanban persistence", async () => {
    repository.create.mockResolvedValue({
      id: "goal-1",
      project_id: "project-1",
      title: "Ship cutover",
      description: null,
      status: "todo",
      moscow: "must",
      priority: null,
      sort_order: 0,
      target_date: null,
      completed_at: null,
      owner_agent_profile_id: null,
      metadata: null,
      is_archived: false,
      created_at: new Date("2026-04-15T00:00:00.000Z"),
      updated_at: new Date("2026-04-15T00:00:00.000Z"),
    });
    repository.findByproject_id.mockResolvedValue([
      repository.create.mock.results[0]?.value,
    ]);

    const created = await service.createGoal("project-1", {
      title: "Ship cutover",
      moscow: "must",
    });

    expect(repository.create).toHaveBeenCalledWith("project-1", {
      title: "Ship cutover",
      moscow: "must",
    });
    expect(created).toEqual(
      expect.objectContaining({
        id: "goal-1",
        project_id: "project-1",
        title: "Ship cutover",
      }),
    );
  });

  it("updates goal status locally", async () => {
    const goal = {
      id: "goal-1",
      project_id: "project-1",
      title: "Ship cutover",
      description: null,
      status: "todo",
      moscow: null,
      priority: null,
      sort_order: 0,
      target_date: null,
      completed_at: null,
      owner_agent_profile_id: null,
      metadata: null,
      is_archived: false,
      created_at: new Date("2026-04-15T00:00:00.000Z"),
      updated_at: new Date("2026-04-15T00:00:00.000Z"),
    };
    repository.findById.mockResolvedValue(goal);
    repository.save.mockResolvedValue({
      ...goal,
      status: "completed",
      completed_at: new Date("2026-04-16T00:00:00.000Z"),
    });

    const updated = await service.updateStatus("project-1", "goal-1", {
      status: "completed",
    });

    expect(updated.status).toBe("completed");
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "goal-1",
        status: "completed",
      }),
    );
  });

  it("throws NotFoundException when goal is missing", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.updateStatus("project-1", "missing", { status: "completed" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("archives, unarchives, and reorders goals through kanban persistence", async () => {
    const goal = buildGoalEntity({ is_archived: true });
    repository.findByproject_id.mockResolvedValue([goal]);
    repository.setArchived.mockResolvedValue(goal);
    repository.reorder.mockResolvedValue([goal]);

    await expect(
      service.setArchived("project-1", "goal-1", true),
    ).resolves.toEqual(expect.objectContaining({ isArchived: true }));
    await expect(
      service.reorderGoals("project-1", ["goal-1"]),
    ).resolves.toHaveLength(1);

    expect(repository.setArchived).toHaveBeenCalledWith(
      "project-1",
      "goal-1",
      true,
    );
    expect(repository.reorder).toHaveBeenCalledWith("project-1", ["goal-1"]);
  });

  it("creates and lists worklogs, including work-item links", async () => {
    const goal = buildGoalEntity();
    const worklog = buildWorklogEntity({
      work_item_id: "work-item-1",
      entry_type: "link",
    });
    repository.findById.mockResolvedValue(goal);
    repository.createWorklog.mockResolvedValue(worklog);
    repository.listWorklogs.mockResolvedValue([worklog]);
    workItems.findByProjectAndId.mockResolvedValue({ id: "work-item-1" });

    await expect(
      service.linkWorkItem("project-1", "goal-1", {
        work_item_id: "work-item-1",
        note: "Linked for delivery",
      }),
    ).resolves.toEqual(expect.objectContaining({ workItemId: "work-item-1" }));
    await expect(
      service.listWorklogs("project-1", "goal-1"),
    ).resolves.toHaveLength(1);

    expect(repository.createWorklog).toHaveBeenCalledWith(
      "project-1",
      "goal-1",
      expect.objectContaining({
        entry_type: "link",
        work_item_id: "work-item-1",
      }),
    );
    expect(repository.listWorklogs).toHaveBeenCalledWith("project-1", "goal-1");
  });
});

function buildGoalEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal-1",
    project_id: "project-1",
    title: "Ship cutover",
    description: null,
    status: "todo",
    moscow: null,
    priority: null,
    sort_order: 0,
    target_date: null,
    completed_at: null,
    owner_agent_profile_id: null,
    metadata: null,
    is_archived: false,
    created_at: new Date("2026-04-15T00:00:00.000Z"),
    updated_at: new Date("2026-04-15T00:00:00.000Z"),
    ...overrides,
  };
}

function buildWorklogEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "worklog-1",
    goal_id: "goal-1",
    project_id: "project-1",
    work_item_id: null,
    entry_type: "note",
    author_type: "user",
    author_id: null,
    author_name: null,
    note: "Progress",
    linked_run_id: null,
    metadata: null,
    created_at: new Date("2026-04-15T00:00:00.000Z"),
    updated_at: new Date("2026-04-15T00:00:00.000Z"),
    ...overrides,
  };
}
