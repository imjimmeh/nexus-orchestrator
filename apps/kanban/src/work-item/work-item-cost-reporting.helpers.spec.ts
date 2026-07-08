import { describe, it, expect, vi } from "vitest";
import {
  buildWorkItemCostSummary,
  computeCostEstimateAccuracy,
} from "./work-item-cost-reporting.helpers";

describe("work-item-cost-reporting.helpers", () => {
  describe("buildWorkItemCostSummary", () => {
    it("should estimate cost to complete (with :complete suffix) for all items in the summary", async () => {
      const items = [
        {
          id: "wi-1",
          project_id: "proj-1",
          title: "Item 1",
          status: "in-progress",
          cost_cents: 100,
          token_spend: 50,
          execution_config: { workflowId: "wf-1" },
          story_points: 3,
          type: "task",
        },
      ];

      const costEstimation = {
        estimate: vi.fn().mockResolvedValue({
          available: true,
          estimatedCostCents: 150,
        }),
      };

      const result = await buildWorkItemCostSummary(items, costEstimation);

      expect(costEstimation.estimate).toHaveBeenCalledWith({
        workflowId: "wf-1:complete",
        type: "task",
        storyPoints: 3,
        modelId: null,
      });

      expect(result).toEqual([
        {
          id: "wi-1",
          project_id: "proj-1",
          title: "Item 1",
          status: "in-progress",
          costCents: 100,
          tokenSpend: 50,
          predictedRemainingCostCents: 150,
          projectedTotalCostCents: 250,
        },
      ]);
    });

    it("should report done items as fully spent with no remaining cost", async () => {
      const items = [
        {
          id: "wi-done",
          project_id: "proj-1",
          title: "Done item",
          status: "done",
          cost_cents: 220,
          token_spend: 80,
          execution_config: { workflowId: "wf-1" },
          story_points: 3,
          type: "task",
        },
      ];

      const costEstimation = {
        estimate: vi.fn(),
      };

      const result = await buildWorkItemCostSummary(items, costEstimation);

      expect(costEstimation.estimate).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          id: "wi-done",
          project_id: "proj-1",
          title: "Done item",
          status: "done",
          costCents: 220,
          tokenSpend: 80,
          predictedRemainingCostCents: 0,
          projectedTotalCostCents: 220,
        },
      ]);
    });

    it("should keep projected total unavailable when remaining estimate is unavailable", async () => {
      const items = [
        {
          id: "wi-1",
          project_id: "proj-1",
          title: "Item 1",
          status: "in-progress",
          cost_cents: 100,
          token_spend: 50,
          execution_config: { workflowId: "wf-1" },
          story_points: 3,
          type: "task",
        },
      ];

      const costEstimation = {
        estimate: vi.fn().mockResolvedValue({
          available: false,
          estimatedCostCents: null,
        }),
      };

      const result = await buildWorkItemCostSummary(items, costEstimation);

      expect(result[0]).toMatchObject({
        costCents: 100,
        predictedRemainingCostCents: null,
        projectedTotalCostCents: null,
      });
    });
  });

  describe("computeCostEstimateAccuracy", () => {
    it("should compute MAE/MAPE using the complete estimates", async () => {
      const attempts = [
        {
          work_item_id: "wi-1",
          workflow_id: "wf-1",
          type: "task",
          story_points: 3,
          total_cost_cents: 200,
        },
      ];

      const costEstimation = {
        estimate: vi.fn().mockResolvedValue({
          available: true,
          estimatedCostCents: 180,
        }),
      };

      const result = await computeCostEstimateAccuracy(
        attempts,
        costEstimation,
      );

      expect(costEstimation.estimate).toHaveBeenCalledWith({
        workflowId: "wf-1:complete",
        type: "task",
        storyPoints: 3,
        modelId: null,
      });

      expect(result).toEqual({
        sampleCount: 1,
        meanAbsoluteErrorCents: 20, // |200 - 180|
        meanAbsolutePercentageError: 0.1, // 20 / 200
      });
    });
  });
});
