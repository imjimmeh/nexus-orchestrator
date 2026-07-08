import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanExternalConnectionEntity } from "../entities/kanban-external-connection.entity";
import { KanbanExternalConnectionRepository } from "./kanban-external-connection.repository";

type MockRepository = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createRepository() {
  const typeOrmRepository = {
    findOne: vi.fn(),
    find: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanExternalConnectionRepository(
      typeOrmRepository as unknown as Repository<KanbanExternalConnectionEntity>,
    ),
  };
}

describe("KanbanExternalConnectionRepository", () => {
  it("create saves a connection from typed input", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const saved = { id: "conn-1" } as KanbanExternalConnectionEntity;
    typeOrmRepository.save.mockResolvedValue(saved);

    const result = await repository.create({
      project_id: "project-1",
      provider_type: "github",
      name: "GitHub Sync",
      status: "active",
      sync_mode: "bidirectional",
      sync_transport: "polling",
      config: { repo: "org/repo" },
      field_mapping: { title: "name" },
      poll_interval_seconds: 300,
    });

    expect(result).toBe(saved);
    expect(typeOrmRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        provider_type: "github",
        name: "GitHub Sync",
        status: "active",
        sync_mode: "bidirectional",
        sync_transport: "polling",
        config: { repo: "org/repo" },
        field_mapping: { title: "name" },
        poll_interval_seconds: 300,
      }),
    );
  });

  it("findByProjectAndId returns the connection when found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const conn = {
      id: "conn-1",
      project_id: "project-1",
    } as KanbanExternalConnectionEntity;
    typeOrmRepository.findOne.mockResolvedValue(conn);

    const result = await repository.findByProjectAndId("project-1", "conn-1");

    expect(result).toBe(conn);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { id: "conn-1", project_id: "project-1" },
    });
  });

  it("findByProjectAndId returns null when not found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.findOne.mockResolvedValue(null);

    const result = await repository.findByProjectAndId("project-1", "conn-1");

    expect(result).toBeNull();
  });

  it("listByProject returns connections ordered by created_at DESC", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [{ id: "conn-1" }] as KanbanExternalConnectionEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByProject("project-1");

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "DESC" },
    });
  });

  it("updateByProjectAndId updates and returns the updated entity", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const updated = {
      id: "conn-1",
      project_id: "project-1",
      name: "Renamed",
    } as KanbanExternalConnectionEntity;
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });
    typeOrmRepository.findOne.mockResolvedValue(updated);

    const result = await repository.updateByProjectAndId(
      "project-1",
      "conn-1",
      {
        name: "Renamed",
      },
    );

    expect(result).toBe(updated);
    expect(typeOrmRepository.update).toHaveBeenCalledWith(
      { id: "conn-1", project_id: "project-1" },
      { name: "Renamed" },
    );
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { id: "conn-1", project_id: "project-1" },
    });
  });

  it("updateByProjectAndId returns null when not found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.update.mockResolvedValue({ affected: 0, raw: [] });

    const result = await repository.updateByProjectAndId(
      "project-1",
      "conn-1",
      {
        name: "Renamed",
      },
    );

    expect(result).toBeNull();
  });

  it("deleteByProjectAndId deletes and returns true when found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

    const result = await repository.deleteByProjectAndId("project-1", "conn-1");

    expect(result).toBe(true);
    expect(typeOrmRepository.delete).toHaveBeenCalledWith({
      id: "conn-1",
      project_id: "project-1",
    });
  });

  it("deleteByProjectAndId returns false when not found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.delete.mockResolvedValue({ affected: 0, raw: [] });

    const result = await repository.deleteByProjectAndId("project-1", "conn-1");

    expect(result).toBe(false);
  });

  it("listActivePollingConnections returns active polling connections", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [{ id: "conn-1" }] as KanbanExternalConnectionEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listActivePollingConnections();

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: {
        status: "active",
        sync_transport: expect.any(Object),
        sync_mode: expect.any(Object),
      },
    });
  });

  it("markSyncSuccess clears last_sync_error and updates last_sync_at", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const when = new Date("2026-06-02T12:00:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markSyncSuccess("conn-1", when);

    expect(typeOrmRepository.update).toHaveBeenCalledWith("conn-1", {
      last_sync_at: when,
      last_sync_error: null,
    });
  });

  it("markSyncFailure sets last_sync_error and updates last_sync_at", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markSyncFailure("conn-1", "Connection refused");

    expect(typeOrmRepository.update).toHaveBeenCalledWith("conn-1", {
      last_sync_error: "Connection refused",
      last_sync_at: expect.any(Date) as Date,
    });
  });

  it("findById returns the connection by id only (no project scope)", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const conn = {
      id: "conn-1",
      project_id: "project-9",
    } as KanbanExternalConnectionEntity;
    typeOrmRepository.findOne.mockResolvedValue(conn);

    const result = await repository.findById("conn-1");

    expect(result).toBe(conn);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { id: "conn-1" },
    });
  });

  it("findById returns null when not found", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.findOne.mockResolvedValue(null);

    const result = await repository.findById("nonexistent");

    expect(result).toBeNull();
  });
});
