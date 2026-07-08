import { describe, it, expect, vi } from "vitest";
import { WorkItemCostBucketStatsRefreshService } from "./work-item-cost-bucket-stats-refresh.service";

describe("WorkItemCostBucketStatsRefreshService", () => {
  it("sums retried attempts per work item, then groups the per-work-item totals by every configured tier", async () => {
    const attempts = [
      {
        work_item_id: "wi-1",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 100,
        total_output_tokens: 20,
        priced_turn_count: 10,
        created_at: new Date("2026-07-07T10:00:00Z"),
      },
      {
        work_item_id: "wi-1",
        workflow_id: "wf-2",
        type: "task",
        story_points: 3,
        total_input_tokens: 200,
        total_output_tokens: 40,
        priced_turn_count: 20,
        created_at: new Date("2026-07-07T11:00:00Z"),
      },
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 150,
        total_output_tokens: 30,
        priced_turn_count: 15,
        created_at: new Date("2026-07-07T10:00:00Z"),
      },
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 50,
        total_output_tokens: 10,
        priced_turn_count: 5,
        created_at: new Date("2026-07-07T10:30:00Z"),
      },
      {
        work_item_id: "wi-3",
        workflow_id: "wf-2",
        type: "bug",
        story_points: null,
        total_input_tokens: 50,
        total_output_tokens: 10,
        priced_turn_count: 5,
        created_at: new Date("2026-07-07T10:00:00Z"),
      },
    ];
    const runCosts = {
      findAllForBucketAggregation: vi.fn().mockResolvedValue(attempts),
    };
    const bucketStats = { upsertBucket: vi.fn().mockResolvedValue(undefined) };
    const workItemRepo = {
      findByIds: vi.fn().mockResolvedValue([
        { id: "wi-1", status: "done" },
        { id: "wi-2", status: "in_progress" },
        { id: "wi-3", status: "done" },
      ]),
    };
    const service = new WorkItemCostBucketStatsRefreshService(
      runCosts as never,
      bucketStats as never,
      workItemRepo as never,
    );

    await service.refreshOnce();

    // Stage wf-1 task 3 SP
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "workflow_type_points",
        workflowId: "wf-1",
        type: "task",
        storyPoints: 3,
        sampleCount: 2, // wi-1 (wf-1) and wi-2 (wf-1 summed)
        meanPricedTurnCount: 15, // wi-1 (10) and wi-2 (15 + 5)
      }),
    );

    // Complete wf-1 task 3 SP starting from wf-1
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "workflow_type_points",
        workflowId: "wf-1:complete",
        type: "task",
        storyPoints: 3,
        sampleCount: 1, // Only wi-1
        meanInputTokens: 300, // wf-1 (100) + wf-2 (200)
        meanOutputTokens: 60, // wf-1 (20) + wf-2 (40)
        meanPricedTurnCount: 30, // wf-1 (10) + wf-2 (20)
      }),
    );

    // Complete wf-2 task 3 SP starting from wf-2
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "workflow_type_points",
        workflowId: "wf-2:complete",
        type: "task",
        storyPoints: 3,
        sampleCount: 1, // Only wi-1
        meanInputTokens: 200, // wf-2 (200)
        meanOutputTokens: 40, // wf-2 (40)
        meanPricedTurnCount: 20, // wf-2 (20)
      }),
    );

    // Global
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "global",
        workflowId: null,
        type: "__all__",
        storyPoints: null,
        sampleCount: 7, // All 7 extended totals (4 stages + 3 complete)
      }),
    );
  });
});
