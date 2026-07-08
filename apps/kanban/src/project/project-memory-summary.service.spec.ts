import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { CharterRegenEnqueuer } from "./charter-regen.enqueuer";
import type { KanbanProjectCharterItemRepository } from "../database/repositories/kanban-project-charter-item.repository";
import { ProjectMemorySummaryService } from "./project-memory-summary.service";

describe("ProjectMemorySummaryService", () => {
  let charterRepo: {
    listByProject: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateContent: ReturnType<typeof vi.fn>;
    deleteById: ReturnType<typeof vi.fn>;
  };
  let charterRegen: { enqueue: ReturnType<typeof vi.fn> };
  let dataSource: { query: ReturnType<typeof vi.fn> };

  function buildService(
    queryRows: Array<{ memory_type: string; count: number | string }> = [],
  ) {
    dataSource = { query: vi.fn().mockResolvedValue(queryRows) };
    charterRegen = { enqueue: vi.fn().mockResolvedValue(undefined) };
    charterRepo = {
      listByProject: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
      updateContent: vi.fn().mockResolvedValue(null),
      deleteById: vi.fn().mockResolvedValue(false),
    };
    return new ProjectMemorySummaryService(
      dataSource as unknown as DataSource,
      charterRegen as unknown as CharterRegenEnqueuer,
      charterRepo as unknown as KanbanProjectCharterItemRepository,
    );
  }

  it("queries memory counts by entity_id only without an entity_type filter", async () => {
    const service = buildService();

    await service.getProjectMemorySummary("project-1");

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("where entity_id = $1"),
      ["project-1"],
    );
    expect(dataSource.query).not.toHaveBeenCalledWith(
      expect.stringContaining("entity_type = $"),
      expect.anything(),
    );
  });

  it("returns zero counts when the project has no memories", async () => {
    const service = buildService();

    await expect(service.getProjectMemorySummary("project-1")).resolves.toEqual(
      {
        entity_type: "project",
        entity_id: "project-1",
        totalCount: 0,
        byType: { preference: 0, fact: 0, history: 0 },
        retrievalTool: "query_memory",
      },
    );
  });

  it("returns grouped counts and total count without memory contents", async () => {
    const service = buildService([
      { memory_type: "preference", count: "2" },
      { memory_type: "fact", count: 3 },
      { memory_type: "history", count: "4" },
      { memory_type: "unknown", count: 99 },
    ]);

    const result = await service.getProjectMemorySummary("project-1");

    expect(result).toEqual({
      entity_type: "project",
      entity_id: "project-1",
      totalCount: 9,
      byType: { preference: 2, fact: 3, history: 4 },
      retrievalTool: "query_memory",
    });
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("segments");
  });

  it("propagates database errors", async () => {
    const service = buildService();
    dataSource.query.mockRejectedValue(new Error("database unavailable"));

    await expect(service.getProjectMemorySummary("project-1")).rejects.toThrow(
      "database unavailable",
    );
  });

  it("propagates non-missing-table errors that mention memory segments", async () => {
    const service = buildService();
    dataSource.query.mockRejectedValue(
      new Error("permission denied for table memory_segments"),
    );

    await expect(service.getProjectMemorySummary("project-1")).rejects.toThrow(
      "permission denied",
    );
  });

  it("returns zero counts when the shared memory table is unavailable", async () => {
    const missingTableError = Object.assign(
      new Error('relation "memory_segments" does not exist'),
      { code: "42P01" },
    );
    const service = buildService();
    dataSource.query.mockRejectedValue(missingTableError);

    await expect(service.getProjectMemorySummary("project-1")).resolves.toEqual(
      {
        entity_type: "project",
        entity_id: "project-1",
        totalCount: 0,
        byType: { preference: 0, fact: 0, history: 0 },
        retrievalTool: "query_memory",
      },
    );
  });

  describe("getProjectMemorySegments", () => {
    it("queries segments with limit, offset, and entity_id filter", async () => {
      const service = buildService();
      const items = [{ id: "1", content: "hello" }];
      const count = [{ count: 1 }];
      dataSource.query
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(count);

      const result = await service.getProjectMemorySegments("project-1", {
        limit: 10,
        offset: 5,
      });

      expect(dataSource.query).toHaveBeenCalledTimes(2);
      expect(dataSource.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(
          "select id, content, memory_type, version, created_at, updated_at",
        ),
        ["project-1", 10, 5],
      );
      expect(dataSource.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("select count(*)::int as count"),
        ["project-1"],
      );
      expect(dataSource.query).not.toHaveBeenCalledWith(
        expect.stringContaining("entity_type = $"),
        expect.anything(),
      );
      expect(result).toEqual({
        items,
        total: 1,
        limit: 10,
        offset: 5,
      });
    });

    it("applies memory_type and query filters if provided", async () => {
      const service = buildService();
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      await service.getProjectMemorySegments("project-1", {
        limit: 10,
        offset: 0,
        memory_type: "preference",
        query: "search-term",
      });

      expect(dataSource.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("and memory_type = $2 and content iLike $3"),
        ["project-1", "preference", "%search-term%", 10, 0],
      );
      expect(dataSource.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("and memory_type = $2 and content iLike $3"),
        ["project-1", "preference", "%search-term%"],
      );
    });

    it("handles missing memory segments table gracefully by returning empty result", async () => {
      const missingTableError = Object.assign(
        new Error('relation "memory_segments" does not exist'),
        { code: "42P01" },
      );
      const service = buildService();
      dataSource.query.mockRejectedValue(missingTableError);

      const result = await service.getProjectMemorySegments("project-1", {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
    });
  });

  describe("charter CRUD via KanbanProjectCharterItemRepository", () => {
    const makeItem = (
      overrides: Partial<{
        id: string;
        category: string;
        content: string;
        memory_type: string;
        source: string;
        version: number;
        created_at: Date;
        updated_at: Date;
      }> = {},
    ) => ({
      id: "a",
      category: "vision",
      content: "V",
      memory_type: "fact",
      source: "onboarding_chat",
      version: 1,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
      ...overrides,
    });

    it("getCharterMemories maps charter items to CharterMemoryRow shape", async () => {
      const service = buildService();
      const item = makeItem();
      charterRepo.listByProject.mockResolvedValue([item]);

      const rows = await service.getCharterMemories("p1");

      expect(charterRepo.listByProject).toHaveBeenCalledWith("p1");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "a",
        content: "V",
        memory_type: "fact",
        metadata: { category: "vision", source: "onboarding_chat" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      });
    });

    it("getCharterMemories returns empty array when no items exist", async () => {
      const service = buildService();
      charterRepo.listByProject.mockResolvedValue([]);

      const rows = await service.getCharterMemories("p1");

      expect(rows).toEqual([]);
    });

    it("createCharterMemory persists via repo and enqueues regen", async () => {
      const service = buildService();
      const item = makeItem({ category: "requirement", content: "R" });
      charterRepo.create.mockResolvedValue(item);

      const result = await service.createCharterMemory(
        "p1",
        "requirement",
        "R",
        "fact",
      );

      expect(charterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "p1",
          category: "requirement",
          content: "R",
          memory_type: "fact",
          source: "user_edit",
        }),
      );
      expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
      expect(result).toMatchObject({ id: "a", content: "R" });
    });

    it("createProjectMemory persists a charter item and enqueues regen", async () => {
      const service = buildService();
      const item = makeItem({ category: "requirement", content: "R" });
      charterRepo.create.mockResolvedValue(item);

      await service.createProjectMemory("p1", {
        category: "requirement",
        content: "R",
        source: "onboarding_chat",
      });

      expect(charterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "p1",
          category: "requirement",
          content: "R",
          source: "onboarding_chat",
        }),
      );
      expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
    });

    it("createProjectMemory uses preference memory_type for preference category", async () => {
      const service = buildService();
      const item = makeItem({
        category: "preference",
        memory_type: "preference",
      });
      charterRepo.create.mockResolvedValue(item);

      await service.createProjectMemory("p1", {
        category: "preference",
        content: "prefers dark mode",
        source: "onboarding_chat",
        confidence: 0.9,
      });

      expect(charterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          memory_type: "preference",
        }),
      );
    });

    it("createProjectMemory defaults memory_type to fact for non-preference categories", async () => {
      const service = buildService();
      const item = makeItem({ category: "requirement", memory_type: "fact" });
      charterRepo.create.mockResolvedValue(item);

      const result = await service.createProjectMemory("p1", {
        category: "requirement",
        content: "x",
        source: "onboarding_chat",
      });

      expect(charterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ memory_type: "fact" }),
      );
      expect(result.memory_type).toBe("fact");
    });

    it("updateCharterMemory delegates to repo and enqueues regen", async () => {
      const service = buildService();
      const updated = makeItem({ content: "Updated" });
      charterRepo.updateContent.mockResolvedValue(updated);

      const result = await service.updateCharterMemory(
        "mem-1",
        "p1",
        "Updated",
      );

      expect(charterRepo.updateContent).toHaveBeenCalledWith(
        "mem-1",
        "p1",
        "Updated",
      );
      expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
      expect(result).not.toBeNull();
      expect(result?.content).toBe("Updated");
    });

    it("updateCharterMemory returns null when item not found", async () => {
      const service = buildService();
      charterRepo.updateContent.mockResolvedValue(null);

      const result = await service.updateCharterMemory(
        "non-existent",
        "p1",
        "content",
      );

      expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
      expect(result).toBeNull();
    });

    it("deleteCharterMemory delegates to repo and enqueues regen", async () => {
      const service = buildService();
      charterRepo.deleteById.mockResolvedValue(true);

      const deleted = await service.deleteCharterMemory("mem-1", "p1");

      expect(charterRepo.deleteById).toHaveBeenCalledWith("mem-1", "p1");
      expect(charterRegen.enqueue).toHaveBeenCalledWith("p1");
      expect(deleted).toBe(true);
    });

    it("deleteCharterMemory returns false when item not found", async () => {
      const service = buildService();
      charterRepo.deleteById.mockResolvedValue(false);

      const deleted = await service.deleteCharterMemory("non-existent", "p1");

      expect(deleted).toBe(false);
    });
  });
});
