import { describe, expect, it, vi } from "vitest";
import type { DeleteResult, Repository } from "typeorm";
import { KanbanProjectCharterItemEntity } from "../entities/kanban-project-charter-item.entity";
import { KanbanProjectCharterItemRepository } from "./kanban-project-charter-item.repository";

type MockRepository = Pick<
  Repository<KanbanProjectCharterItemEntity>,
  "find" | "save" | "create" | "findOne" | "delete"
>;

function createRepository() {
  const typeOrmRepository = {
    find: vi.fn(),
    save: vi.fn(),
    create: vi.fn((x: Partial<KanbanProjectCharterItemEntity>) => x),
    findOne: vi.fn(),
    delete: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanProjectCharterItemRepository(
      typeOrmRepository as unknown as Repository<KanbanProjectCharterItemEntity>,
    ),
  };
}

describe("KanbanProjectCharterItemRepository", () => {
  it("lists items for a project ordered by created_at asc", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.find.mockResolvedValue([{ id: "1" }]);

    const result = await repository.listByProject("p1");

    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "p1" },
      order: { created_at: "ASC" },
    });
    expect(result).toEqual([{ id: "1" }]);
  });

  it("creates an item with version 1", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.save.mockImplementation(
      (x: Partial<KanbanProjectCharterItemEntity>) =>
        Promise.resolve({ id: "new", ...x }),
    );

    const created = await repository.create({
      project_id: "p1",
      category: "vision",
      content: "c",
      memory_type: "fact",
      source: "user_edit",
    });

    expect(created.version).toBe(1);
    expect(created.category).toBe("vision");
  });

  it("returns null when updating a non-existent item", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.findOne.mockResolvedValue(null);

    expect(await repository.updateContent("x", "p1", "new")).toBeNull();
  });

  it("reports false when deleting nothing", async () => {
    const { repository, typeOrmRepository } = createRepository();
    typeOrmRepository.delete.mockResolvedValue({
      affected: 0,
    });

    expect(await repository.deleteById("x", "p1")).toBe(false);
  });
});
