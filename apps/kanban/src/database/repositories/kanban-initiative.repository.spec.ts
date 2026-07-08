import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import type { KanbanInitiativeEntity } from "../entities/kanban-initiative.entity";
import type { KanbanInitiativeGoalEntity } from "../entities/kanban-initiative-goal.entity";
import type { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity";
import { KanbanInitiativeRepository } from "./kanban-initiative.repository";

function repoMock() {
  return {
    create: vi.fn((v) => v),
    save: vi.fn((v) => Promise.resolve(v)),
    find: vi.fn(),
    findOne: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    delete: vi.fn(),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe("KanbanInitiativeRepository", () => {
  let initiatives: ReturnType<typeof repoMock>;
  let links: ReturnType<typeof repoMock>;
  let workItems: ReturnType<typeof repoMock>;
  let repo: KanbanInitiativeRepository;

  beforeEach(() => {
    initiatives = repoMock();
    links = repoMock();
    workItems = repoMock();
    repo = new KanbanInitiativeRepository(
      initiatives as unknown as Repository<KanbanInitiativeEntity>,
      links as unknown as Repository<KanbanInitiativeGoalEntity>,
      workItems as unknown as Repository<KanbanWorkItemEntity>,
    );
  });

  it("creates an initiative defaulting priority to the current count", async () => {
    initiatives.count.mockResolvedValue(2);
    await repo.create("p1", { title: "Harden loop" });
    expect(initiatives.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "p1",
        title: "Harden loop",
        priority: 2,
      }),
    );
  });

  it("lists initiatives ordered by priority ASC then created_at ASC", async () => {
    initiatives.find.mockResolvedValue([]);
    await repo.findByProjectId("p1");
    expect(initiatives.find).toHaveBeenCalledWith({
      where: { project_id: "p1" },
      order: { priority: "ASC", created_at: "ASC" },
    });
  });

  it("links a goal idempotently via save", async () => {
    await repo.linkGoal("i1", "g1");
    expect(links.save).toHaveBeenCalledWith({
      initiative_id: "i1",
      goal_id: "g1",
    });
  });

  it("assigns a work item to an initiative", async () => {
    await repo.assignWorkItem("p1", "w1", "i1");
    expect(workItems.update).toHaveBeenCalledWith(
      { id: "w1", project_id: "p1" },
      { initiative_id: "i1" },
    );
  });

  it("returns goal ids for an initiative", async () => {
    links.find.mockResolvedValue([
      { initiative_id: "i1", goal_id: "g1" },
      { initiative_id: "i1", goal_id: "g2" },
    ]);
    const ids = await repo.findGoalIds("i1");
    expect(ids).toEqual(["g1", "g2"]);
  });
});
