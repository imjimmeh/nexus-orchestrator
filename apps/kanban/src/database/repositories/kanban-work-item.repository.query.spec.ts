import { describe, expect, it, vi, beforeEach } from "vitest";
import { KanbanWorkItemRepository } from "./kanban-work-item.repository";

function makeQbMock() {
  const qb: Record<string, unknown> = {};
  for (const m of ["andWhere", "orderBy", "addOrderBy", "skip", "take"]) {
    qb[m] = vi.fn(() => qb);
  }
  qb.getManyAndCount = vi.fn(() => Promise.resolve([[{ id: "wi-1" }], 1]));
  return qb as {
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    addOrderBy: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
    take: ReturnType<typeof vi.fn>;
    getManyAndCount: ReturnType<typeof vi.fn>;
  };
}

describe("KanbanWorkItemRepository.queryWorkItems", () => {
  let qb: ReturnType<typeof makeQbMock>;
  let repo: KanbanWorkItemRepository;

  beforeEach(() => {
    qb = makeQbMock();
    const ormRepo = { createQueryBuilder: vi.fn(() => qb) };
    repo = new KanbanWorkItemRepository(
      ormRepo as never,
      {} as never,
      {} as never,
    );
  });

  it("returns items and total", async () => {
    const result = await repo.queryWorkItems({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
    expect(result).toEqual({ items: [{ id: "wi-1" }], total: 1 });
  });

  it("applies status, project, search filters and validated ordering", async () => {
    await repo.queryWorkItems({
      projectId: "p1",
      status: ["todo"],
      search: "login",
      sortBy: "title",
      sortDir: "asc",
      limit: 10,
      offset: 5,
    });
    expect(qb.andWhere).toHaveBeenCalledWith("item.project_id = :projectId", {
      projectId: "p1",
    });
    expect(qb.andWhere).toHaveBeenCalledWith("item.status IN (:...status)", {
      status: ["todo"],
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      "(item.title ILIKE :search OR item.description ILIKE :search)",
      { search: "%login%" },
    );
    expect(qb.orderBy).toHaveBeenCalledWith("item.title", "ASC");
    expect(qb.addOrderBy).toHaveBeenCalledWith("item.id", "ASC");
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(qb.take).toHaveBeenCalledWith(10);
  });
});
