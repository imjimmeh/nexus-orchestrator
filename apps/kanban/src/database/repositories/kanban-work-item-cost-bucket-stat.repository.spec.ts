import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { KanbanWorkItemCostBucketStatEntity } from "../entities/kanban-work-item-cost-bucket-stat.entity";
import { KanbanWorkItemCostBucketStatRepository } from "./kanban-work-item-cost-bucket-stat.repository";

interface QueryBuilderMock {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
}

describe("KanbanWorkItemCostBucketStatRepository", () => {
  let repo: KanbanWorkItemCostBucketStatRepository;
  let mockRepo: {
    upsert: ReturnType<typeof vi.fn>;
    createQueryBuilder: () => QueryBuilderMock;
  };

  beforeEach(async () => {
    const queryBuilder: QueryBuilderMock = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanWorkItemCostBucketStatRepository,
        {
          provide: getRepositoryToken(KanbanWorkItemCostBucketStatEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanWorkItemCostBucketStatRepository);
  });

  it("findByKey looks up a bucket by tier/workflow/type/points, handling null workflow/points", async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getOne.mockResolvedValue({
      tier: "global",
      sample_count: 12,
    });

    const result = await repo.findByKey({
      tier: "global",
      workflowId: null,
      type: "task",
      storyPoints: null,
    });

    expect(queryBuilder.where).toHaveBeenCalledWith("s.tier = :tier", {
      tier: "global",
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith("s.workflow_id IS NULL");
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "s.story_points IS NULL",
    );
    expect(result).toEqual({ tier: "global", sample_count: 12 });
  });

  it("findByKey prefers the newest bucket when duplicate nullable keys exist", async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getOne.mockResolvedValue({
      tier: "global",
      sample_count: 1619,
      computed_at: new Date("2026-07-08T13:03:59.284Z"),
    });

    const result = await repo.findByKey({
      tier: "global",
      workflowId: null,
      type: "story",
      storyPoints: null,
    });

    expect(queryBuilder.orderBy).toHaveBeenCalledWith("s.computed_at", "DESC");
    expect(result).toEqual({
      tier: "global",
      sample_count: 1619,
      computed_at: new Date("2026-07-08T13:03:59.284Z"),
    });
  });
});
