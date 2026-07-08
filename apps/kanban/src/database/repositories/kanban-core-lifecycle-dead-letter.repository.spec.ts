import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanCoreLifecycleDeadLetterEntity } from "../entities/kanban-core-lifecycle-dead-letter.entity";
import { KanbanCoreLifecycleDeadLetterRepository } from "./kanban-core-lifecycle-dead-letter.repository";

type MockRepository = {
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createRepository() {
  const typeOrmRepository = {
    create: vi.fn((entity) => entity as KanbanCoreLifecycleDeadLetterEntity),
    save: vi.fn(),
    count: vi.fn(),
    find: vi.fn(),
    delete: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanCoreLifecycleDeadLetterRepository(
      typeOrmRepository as unknown as Repository<KanbanCoreLifecycleDeadLetterEntity>,
    ),
  };
}

describe("KanbanCoreLifecycleDeadLetterRepository", () => {
  it("saveDeadLetter creates and saves the row", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const saved = { id: "dl-1" } as KanbanCoreLifecycleDeadLetterEntity;
    typeOrmRepository.save.mockResolvedValue(saved);

    const result = await repository.saveDeadLetter({
      stream_key: "stream:core:lifecycle",
      stream_id: "10-0",
      reason: "boom",
      payload: { envelope: "{}" },
    });

    expect(result).toBe(saved);
    expect(typeOrmRepository.create).toHaveBeenCalledWith({
      stream_key: "stream:core:lifecycle",
      stream_id: "10-0",
      reason: "boom",
      payload: { envelope: "{}" },
    });
  });

  it("countRecent returns the total row count", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.count.mockResolvedValue(3);

    await expect(repository.countRecent()).resolves.toBe(3);
  });

  it("listDeadLetters returns saved rows ordered oldest-created first", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [
      { id: "dl-1" },
      { id: "dl-2" },
    ] as KanbanCoreLifecycleDeadLetterEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listDeadLetters();

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      order: { created_at: "ASC" },
      take: 100,
    });
  });

  it("listDeadLetters filters by stream_key and honors a custom limit", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([]);

    await repository.listDeadLetters({
      streamKey: "stream:core:lifecycle",
      limit: 5,
    });

    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { stream_key: "stream:core:lifecycle" },
      order: { created_at: "ASC" },
      take: 5,
    });
  });

  it("deleteDeadLetter removes the row by id", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

    await repository.deleteDeadLetter("dl-1");

    expect(typeOrmRepository.delete).toHaveBeenCalledWith("dl-1");
  });
});
