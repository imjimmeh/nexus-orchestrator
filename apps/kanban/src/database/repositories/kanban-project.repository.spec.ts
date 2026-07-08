import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { KanbanProjectEntity } from "../entities/kanban-project.entity";
import { KanbanProjectRepository } from "./kanban-project.repository";

type MockRepository = Pick<
  Repository<KanbanProjectEntity>,
  "create" | "save" | "find" | "findOne" | "delete"
>;

function createRepository() {
  const typeOrmRepository = {
    create: vi.fn((x: Partial<KanbanProjectEntity>) => x),
    save: vi.fn((x: Partial<KanbanProjectEntity>) => Promise.resolve({ ...x })),
    find: vi.fn(),
    findOne: vi.fn(),
    delete: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanProjectRepository(
      typeOrmRepository as unknown as Repository<KanbanProjectEntity>,
    ),
  };
}

describe("KanbanProjectRepository.runtime_toolchains", () => {
  it("round-trips a runtime toolchain config through create + save", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const config: RuntimeToolchainConfig = {
      toolchains: [{ tool: "python", version: "3.12" }],
      aptPackages: ["libpq-dev"],
      caches: [{ id: "pip", path: "/root/.cache/pip" }],
    };

    const saved = await repository.save({
      id: "p1",
      name: "Example",
      runtime_toolchains: config,
    });

    expect(typeOrmRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ runtime_toolchains: config }),
    );
    expect(saved.runtime_toolchains?.toolchains[0].tool).toBe("python");
    expect(saved.runtime_toolchains?.aptPackages).toEqual(["libpq-dev"]);
  });

  it("defaults to undefined when not provided", async () => {
    const { repository } = createRepository();

    const saved = await repository.save({ id: "p2", name: "No toolchains" });

    expect(saved.runtime_toolchains).toBeUndefined();
  });
});
