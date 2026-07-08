import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanInitiativeRepository } from "../database/repositories/kanban-initiative.repository";
import { InitiativesService } from "./initiatives.service";

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    project_id: "p1",
    title: "Harden loop",
    description: null,
    horizon: "now",
    priority: 0,
    status: "active",
    last_reviewed_at: null,
    created_at: new Date("2026-06-12T00:00:00.000Z"),
    updated_at: new Date("2026-06-12T00:00:00.000Z"),
    ...overrides,
  };
}

describe("InitiativesService", () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findByProjectId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    linkGoal: ReturnType<typeof vi.fn>;
    unlinkGoal: ReturnType<typeof vi.fn>;
    findGoalIds: ReturnType<typeof vi.fn>;
    assignWorkItem: ReturnType<typeof vi.fn>;
  };
  let service: InitiativesService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue(entity()),
      save: vi.fn().mockResolvedValue(entity({ title: "Renamed" })),
      findByProjectId: vi.fn().mockResolvedValue([entity()]),
      findById: vi.fn().mockResolvedValue(entity()),
      linkGoal: vi.fn(),
      unlinkGoal: vi.fn(),
      findGoalIds: vi.fn().mockResolvedValue(["g1"]),
      assignWorkItem: vi.fn(),
    };
    service = new InitiativesService(
      repo as unknown as KanbanInitiativeRepository,
    );
  });

  it("creates an initiative and links its goals, returning a camelCase record with goalIds", async () => {
    const result = await service.createInitiative("p1", {
      title: "Harden loop",
      horizon: "now",
      goalIds: ["g1"],
    });
    expect(repo.create).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ title: "Harden loop", horizon: "now" }),
    );
    expect(repo.linkGoal).toHaveBeenCalledWith("i1", "g1");
    expect(result).toMatchObject({
      id: "i1",
      goalIds: ["g1"],
      lastReviewedAt: null,
    });
    expect(result.created_at).toBe("2026-06-12T00:00:00.000Z");
  });

  it("lists initiatives with their goal ids", async () => {
    const list = await service.listInitiatives("p1");
    expect(list).toHaveLength(1);
    expect(list[0].goalIds).toEqual(["g1"]);
  });

  it("throws NotFoundException updating a missing initiative", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.updateInitiative("p1", "missing", { title: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stamps last_reviewed_at when re-prioritising (grooming)", async () => {
    await service.setPriority("p1", "i1", 5);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 5,
        last_reviewed_at: expect.any(Date),
      }),
    );
  });

  it("assigns a work item to an initiative after verifying it exists", async () => {
    await service.assignWorkItem("p1", "w1", "i1");
    expect(repo.findById).toHaveBeenCalledWith("p1", "i1");
    expect(repo.assignWorkItem).toHaveBeenCalledWith("p1", "w1", "i1");
  });
});
