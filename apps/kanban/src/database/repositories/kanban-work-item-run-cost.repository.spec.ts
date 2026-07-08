import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { KanbanWorkItemRunCostEntity } from "../entities/kanban-work-item-run-cost.entity";
import { KanbanWorkItemRunCostRepository } from "./kanban-work-item-run-cost.repository";

describe("KanbanWorkItemRunCostRepository", () => {
  let repo: KanbanWorkItemRunCostRepository;
  let mockRepo: {
    findOne: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    mockRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn((input) => input),
      save: vi.fn((input) => ({ id: "cost-1", ...input })),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanWorkItemRunCostRepository,
        {
          provide: getRepositoryToken(KanbanWorkItemRunCostEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanWorkItemRunCostRepository);
  });

  it("recordAttempt inserts a new row and computes attempt_number/is_retry from prior count", async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.count.mockResolvedValue(1);

    const result = await repo.recordAttempt({
      work_item_id: "wi-1",
      run_id: "run-2",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      priority: "p2",
      model_breakdown: [],
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_cost_cents: 5,
      priced_turn_count: 4,
      started_at: null,
      completed_at: null,
    });

    expect(result).toEqual({ inserted: true });
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_number: 2, is_retry: true }),
    );
  });

  it("recordAttempt is a no-op when a row for run_id already exists", async () => {
    mockRepo.findOne.mockResolvedValue({ id: "existing", run_id: "run-1" });

    const result = await repo.recordAttempt({
      work_item_id: "wi-1",
      run_id: "run-1",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      priority: "p2",
      model_breakdown: [],
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_cost_cents: 5,
      priced_turn_count: 4,
      started_at: null,
      completed_at: null,
    });

    expect(result).toEqual({ inserted: false });
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});
