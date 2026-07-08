import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanSyncOperationLogEntity } from "../entities/kanban-sync-operation-log.entity";
import { KanbanSyncOperationLogRepository } from "./kanban-sync-operation-log.repository";

type MockRepository = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createRepository() {
  const typeOrmRepository = {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanSyncOperationLogRepository(
      typeOrmRepository as unknown as Repository<KanbanSyncOperationLogEntity>,
    ),
  };
}

describe("KanbanSyncOperationLogRepository", () => {
  it("createOperation saves an operation log entry", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const saved = { id: "op-1" } as KanbanSyncOperationLogEntity;
    typeOrmRepository.save.mockResolvedValue(saved);

    const result = await repository.createOperation({
      connection_id: "conn-1",
      project_id: "project-1",
      work_item_id: "item-1",
      external_id: "ext-123",
      direction: "inbound",
      operation: "import",
      status: "pending",
      details: { source: "webhook" },
    });

    expect(result).toBe(saved);
    expect(typeOrmRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: "conn-1",
        project_id: "project-1",
        work_item_id: "item-1",
        external_id: "ext-123",
        direction: "inbound",
        operation: "import",
        status: "pending",
        details: { source: "webhook" },
      }),
    );
    expect(typeOrmRepository.save.mock.calls[0]?.[0].started_at).toBeInstanceOf(
      Date,
    );
  });

  it("completeOperation updates and returns the completed entry", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const completed = {
      id: "op-1",
      status: "success",
    } as KanbanSyncOperationLogEntity;
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });
    typeOrmRepository.findOne.mockResolvedValue(completed);

    const result = await repository.completeOperation(
      "op-1",
      "success",
      "Done",
      { rows: 1 },
    );

    expect(result).toBe(completed);
    expect(typeOrmRepository.update).toHaveBeenCalledWith("op-1", {
      status: "success",
      message: "Done",
      details: { rows: 1 },
      completed_at: expect.any(Date) as Date,
    });
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { id: "op-1" },
    });
  });

  it("completeOperation omits details from update payload when not provided", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const completed = {
      id: "op-1",
      status: "failed",
      details: { old: true },
    } as KanbanSyncOperationLogEntity;
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });
    typeOrmRepository.findOne.mockResolvedValue(completed);

    const result = await repository.completeOperation(
      "op-1",
      "failed",
      "Error",
    );

    expect(result).toBe(completed);
    expect(typeOrmRepository.update).toHaveBeenCalledWith("op-1", {
      status: "failed",
      message: "Error",
      completed_at: expect.any(Date) as Date,
    });
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { id: "op-1" },
    });
  });

  it("completeOperation returns null when not found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.update.mockResolvedValue({ affected: 0, raw: [] });

    const result = await repository.completeOperation(
      "op-1",
      "failed",
      "Error",
    );

    expect(result).toBeNull();
  });

  it("listByConnection returns operations ordered by created_at DESC", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [{ id: "op-1" }] as KanbanSyncOperationLogEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByConnection("conn-1");

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { connection_id: "conn-1" },
      order: { created_at: "DESC" },
      take: 50,
      skip: 0,
    });
  });

  it("listByConnection supports limit and offset", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [] as KanbanSyncOperationLogEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByConnection("conn-1", 10, 20);

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { connection_id: "conn-1" },
      order: { created_at: "DESC" },
      take: 10,
      skip: 20,
    });
  });

  it("listByProject returns operations ordered by created_at DESC", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [{ id: "op-1" }] as KanbanSyncOperationLogEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByProject("project-1");

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "DESC" },
      take: 50,
      skip: 0,
    });
  });

  it("listByProject supports limit and offset", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([]);

    const result = await repository.listByProject("project-1", 25, 100);

    expect(result).toEqual([]);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "DESC" },
      take: 25,
      skip: 100,
    });
  });

  it("listByWorkItem returns operations ordered by created_at DESC", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [{ id: "op-1" }] as KanbanSyncOperationLogEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByWorkItem("item-1");

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { work_item_id: "item-1" },
      order: { created_at: "DESC" },
      take: 50,
      skip: 0,
    });
  });

  it("listByWorkItem supports limit and offset", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([]);

    const result = await repository.listByWorkItem("item-1", 5, 0);

    expect(result).toEqual([]);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { work_item_id: "item-1" },
      order: { created_at: "DESC" },
      take: 5,
      skip: 0,
    });
  });
});
