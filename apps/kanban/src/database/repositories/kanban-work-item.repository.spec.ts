import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanWorkItemDependencyEntity } from "../entities/kanban-work-item-dependency.entity.js";
import { KanbanWorkItemSubtaskEntity } from "../entities/kanban-work-item-subtask.entity.js";
import { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity.js";
import { KanbanWorkItemRepository } from "./kanban-work-item.repository.js";

type QueryBuilderMock = {
  select: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
  getRawMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setParameter: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  setLock: ReturnType<typeof vi.fn>;
};

type WorkItemTypeOrmRepositoryMock = {
  createQueryBuilder: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
};

function createQueryBuilderMock(): QueryBuilderMock {
  const queryBuilder: QueryBuilderMock = {
    select: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    getOne: vi.fn(),
    getRawMany: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    setParameter: vi.fn(),
    execute: vi.fn(),
    setLock: vi.fn(),
  };
  queryBuilder.select.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);
  queryBuilder.update.mockReturnValue(queryBuilder);
  queryBuilder.set.mockReturnValue(queryBuilder);
  queryBuilder.setParameter.mockReturnValue(queryBuilder);
  queryBuilder.setLock.mockReturnValue(queryBuilder);
  return queryBuilder;
}

function createRepository() {
  const queryBuilder = createQueryBuilderMock();
  const typeOrmRepository: WorkItemTypeOrmRepositoryMock = {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    find: vi.fn(),
    query: vi.fn(),
  };

  const repository = new KanbanWorkItemRepository(
    typeOrmRepository as unknown as Repository<KanbanWorkItemEntity>,
    {} as Repository<KanbanWorkItemDependencyEntity>,
    {} as Repository<KanbanWorkItemSubtaskEntity>,
  );

  return { queryBuilder, repository, typeOrmRepository };
}

describe("KanbanWorkItemRepository", () => {
  it("findByProjectAndIdForUpdate requests a pessimistic write lock scoped to (project_id, id)", async () => {
    const { queryBuilder, repository, typeOrmRepository } = createRepository();
    const workItem = { id: "item-locked" } as KanbanWorkItemEntity;
    queryBuilder.getOne.mockResolvedValue(workItem);

    const result = await repository.findByProjectAndIdForUpdate(
      "project-1",
      "item-locked",
    );

    expect(result).toBe(workItem);
    expect(typeOrmRepository.createQueryBuilder).toHaveBeenCalledWith(
      "workItem",
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "workItem.id = :workItemId",
      { workItemId: "item-locked" },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "workItem.project_id = :project_id",
      { project_id: "project-1" },
    );
    expect(queryBuilder.setLock).toHaveBeenCalledWith("pessimistic_write");
    expect(queryBuilder.getOne).toHaveBeenCalledTimes(1);
  });

  it("findByProjectAndIdForUpdate forwards the lock request when an EntityManager is supplied", async () => {
    const { queryBuilder, repository } = createRepository();
    const managerQueryBuilder = createQueryBuilderMock();
    const managerRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(managerQueryBuilder),
    };
    const manager = {
      getRepository: vi.fn().mockReturnValue(managerRepository),
    };
    const workItem = { id: "item-locked-2" } as KanbanWorkItemEntity;
    managerQueryBuilder.getOne.mockResolvedValue(workItem);

    const result = await repository.findByProjectAndIdForUpdate(
      "project-2",
      "item-locked-2",
      manager as never,
    );

    expect(result).toBe(workItem);
    expect(manager.getRepository).toHaveBeenCalledWith(KanbanWorkItemEntity);
    expect(managerQueryBuilder.where).toHaveBeenCalledWith(
      "workItem.id = :workItemId",
      { workItemId: "item-locked-2" },
    );
    expect(managerQueryBuilder.andWhere).toHaveBeenCalledWith(
      "workItem.project_id = :project_id",
      { project_id: "project-2" },
    );
    expect(managerQueryBuilder.setLock).toHaveBeenCalledWith(
      "pessimistic_write",
    );
    expect(queryBuilder.setLock).not.toHaveBeenCalled();
  });

  it("findByExternalSyncRef returns a work item scoped by project, connection, and external id", async () => {
    const { queryBuilder, repository, typeOrmRepository } = createRepository();
    const workItem = { id: "item-1" } as KanbanWorkItemEntity;
    queryBuilder.getOne.mockResolvedValue(workItem);

    const result = await repository.findByExternalSyncRef(
      "project-1",
      "connection-1",
      "external-1",
    );

    expect(result).toBe(workItem);
    expect(typeOrmRepository.createQueryBuilder).toHaveBeenCalledWith(
      "workItem",
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "workItem.project_id = :projectId",
      { projectId: "project-1" },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "workItem.metadata->'external_sync'->>'connection_id' = :connectionId",
      { connectionId: "connection-1" },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "workItem.metadata->'external_sync'->>'external_id' = :externalId",
      { externalId: "external-1" },
    );
  });

  it("addTokenSpend atomically increments token_spend scoped to project and work item", async () => {
    const { queryBuilder, repository } = createRepository();
    queryBuilder.execute.mockResolvedValue({ affected: 1 });

    const result = await repository.addTokenSpend({
      project_id: "project-1",
      workItemId: "item-1",
      amount: 1500,
    });

    expect(result).toBe(true);
    expect(queryBuilder.set).toHaveBeenCalledWith({
      token_spend: expect.any(Function),
    });
    expect(queryBuilder.where).toHaveBeenCalledWith("id = :workItemId", {
      workItemId: "item-1",
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "project_id = :project_id",
      { project_id: "project-1" },
    );
    expect(queryBuilder.setParameter).toHaveBeenCalledWith("amount", 1500);
  });

  it("addTokenSpend is a no-op for non-positive amounts", async () => {
    const { repository, typeOrmRepository } = createRepository();

    const result = await repository.addTokenSpend({
      project_id: "project-1",
      workItemId: "item-1",
      amount: 0,
    });

    expect(result).toBe(false);
    expect(typeOrmRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("findByproject_id passes skip and take when limit/offset are provided", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([
      { id: "item-3" } as KanbanWorkItemEntity,
    ]);

    await repository.findByproject_id("project-1", { limit: 10, offset: 20 });

    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "ASC" },
      take: 10,
      skip: 20,
    });
  });

  it("findByproject_id omits skip/take when limit/offset are not provided", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([]);

    await repository.findByproject_id("project-1");

    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "ASC" },
    });
  });

  it("addCostSpend atomically increments cost_cents scoped to project and work item", async () => {
    const { queryBuilder, repository } = createRepository();
    queryBuilder.execute.mockResolvedValue({ affected: 1 });

    const result = await repository.addCostSpend({
      project_id: "project-1",
      workItemId: "item-1",
      amountCents: 250,
    });

    expect(result).toBe(true);
    expect(queryBuilder.set).toHaveBeenCalledWith({
      cost_cents: expect.any(Function),
    });
    expect(queryBuilder.where).toHaveBeenCalledWith("id = :workItemId", {
      workItemId: "item-1",
    });
    expect(queryBuilder.setParameter).toHaveBeenCalledWith("amountCents", 250);
  });

  it("addCostSpend is a no-op for non-positive amounts", async () => {
    const { repository, typeOrmRepository } = createRepository();

    const result = await repository.addCostSpend({
      project_id: "project-1",
      workItemId: "item-1",
      amountCents: 0,
    });

    expect(result).toBe(false);
    expect(typeOrmRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("findAll passes skip and take when limit/offset are provided", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([
      { id: "item-1" } as KanbanWorkItemEntity,
    ]);

    await repository.findAll({ limit: 5, offset: 0 });

    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      order: { created_at: "ASC" },
      take: 5,
      skip: 0,
    });
  });

  it("recordExecutionStatus sets last_execution_status keyed on the attached run and returns true", async () => {
    const { queryBuilder, repository } = createRepository();
    queryBuilder.execute.mockResolvedValue({ affected: 1 });

    const updated = await repository.recordExecutionStatus({
      project_id: "p1",
      workItemId: "w1",
      runId: "run-1",
      status: "RUNNING",
    });

    expect(updated).toBe(true);
    expect(queryBuilder.set).toHaveBeenCalledWith({
      last_execution_status: "RUNNING",
    });
    expect(queryBuilder.execute).toHaveBeenCalledOnce();
  });

  it("recordExecutionStatus returns false when no row matches the run", async () => {
    const { queryBuilder, repository } = createRepository();
    queryBuilder.execute.mockResolvedValue({ affected: 0 });

    const updated = await repository.recordExecutionStatus({
      project_id: "p1",
      workItemId: "w1",
      runId: "run-1",
      status: "RUNNING",
    });

    expect(updated).toBe(false);
  });

  it("clearRunLinksIfMatches clears links and records the terminal status", async () => {
    const { queryBuilder, repository } = createRepository();
    queryBuilder.execute.mockResolvedValue({ affected: 1 });

    await repository.clearRunLinksIfMatches("p1", "w1", "run-1", "FAILED");

    expect(queryBuilder.set).toHaveBeenCalledWith({
      linked_run_id: null,
      current_execution_id: null,
      last_execution_status: "FAILED",
    });
  });

  it("existsChildrenFor returns only parentIds that have at least one child", async () => {
    const { queryBuilder, repository, typeOrmRepository } = createRepository();
    queryBuilder.getRawMany.mockResolvedValue([{ parentId: "epic-1" }]);

    const result = await repository.existsChildrenFor(["epic-1", "lone-1"]);

    expect(result).toEqual(new Set(["epic-1"]));
    expect(typeOrmRepository.createQueryBuilder).toHaveBeenCalledWith("wi");
    expect(queryBuilder.select).toHaveBeenCalledWith(
      "DISTINCT wi.parent_work_item_id",
      "parentId",
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "wi.parent_work_item_id IN (:...parentIds)",
      { parentIds: ["epic-1", "lone-1"] },
    );
  });

  it("existsChildrenFor returns an empty set without querying when given no parentIds", async () => {
    const { repository, typeOrmRepository } = createRepository();

    const result = await repository.existsChildrenFor([]);

    expect(result).toEqual(new Set());
    expect(typeOrmRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("findChildIds returns the ids of a work item's direct children", async () => {
    const { queryBuilder, repository, typeOrmRepository } = createRepository();
    queryBuilder.getRawMany.mockResolvedValue([
      { id: "child-1" },
      { id: "child-2" },
    ]);

    const result = await repository.findChildIds("parent-1");

    expect(result).toEqual(["child-1", "child-2"]);
    expect(typeOrmRepository.createQueryBuilder).toHaveBeenCalledWith("wi");
    expect(queryBuilder.where).toHaveBeenCalledWith(
      "wi.parent_work_item_id = :parentId",
      { parentId: "parent-1" },
    );
  });

  it("computeRolledUpPoints sums story_points across the whole descendant subtree", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.query.mockResolvedValue([{ total: 8 }]);

    const result = await repository.computeRolledUpPoints("epic-1");

    expect(result).toBe(8);
    expect(typeOrmRepository.query).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE"),
      ["epic-1"],
    );
    const sqlArg = (typeOrmRepository.query as any).mock.calls[0][0];
    expect(sqlArg).toContain("kanban_work_items");
    expect(sqlArg).toContain("parent_work_item_id = $1");
    expect(sqlArg).toContain("c.parent_work_item_id = d.id");
    expect(sqlArg).toContain("SUM(story_points)");
  });

  it("computeRolledUpPoints returns null when no descendant has story_points set", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.query.mockResolvedValue([{ total: null }]);

    const result = await repository.computeRolledUpPoints("epic-1");

    expect(result).toBeNull();
  });
});
