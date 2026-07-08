import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import { WorkItemCostEstimationController } from "./work-item-cost-estimation.controller";
import type { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";
import type { CoreModelPricingClientService } from "../../core/core-model-pricing-client.service";
import type { KanbanModelPricingCacheRepository } from "../../database/repositories/kanban-model-pricing-cache.repository";

describe("WorkItemCostEstimationController", () => {
  const dummyPricingClient = {
    resolveModel: vi.fn().mockResolvedValue({
      modelName: "MiniMax-M2.5-TEE",
      providerName: "MiniMaxAI",
    }),
  } as unknown as CoreModelPricingClientService;

  const dummyPricingCache = {
    findAll: vi.fn().mockResolvedValue([
      {
        model_id: "m-1",
        model_name: "MiniMax-M2.5-TEE",
        provider_name: "MiniMaxAI",
        input_token_cents_per_million: 10,
        output_token_cents_per_million: 10,
      },
    ]),
  } as unknown as KanbanModelPricingCacheRepository;

  it("preview delegates the request body straight to the estimation service", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 3,
      estimatedCostCents: 100,
      lowCostCents: 80,
      highCostCents: 120,
      whatIf: [],
    };
    const estimate = vi.fn().mockResolvedValue(estimationResult);
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn(),
    } as unknown as KanbanWorkItemRepository;
    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      dummyPricingClient,
      dummyPricingCache,
    );

    const result = await controller.preview({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });
    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-1:complete",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });
    expect(result).toEqual({
      success: true,
      data: {
        ...estimationResult,
        currentStage: estimationResult,
        fullyImplement: estimationResult,
      },
    });
  });

  it("getForWorkItem resolves the work item's current type, points, workflow, and model before estimating", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 1,
      estimatedCostCents: 50,
      lowCostCents: 40,
      highCostCents: 60,
      whatIf: [],
    };
    const estimate = vi.fn().mockResolvedValue(estimationResult);
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue({
        id: "wi-1",
        project_id: "proj-1",
        type: "bug",
        status: "in-progress",
        story_points: 5,
        cost_cents: 125,
        execution_config: { model: "model-2", workflowId: "wf-2" },
      }),
    } as unknown as KanbanWorkItemRepository;
    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      dummyPricingClient,
      dummyPricingCache,
    );

    const result = await controller.getForWorkItem("proj-1", "wi-1");

    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-2",
      type: "bug",
      storyPoints: 5,
      modelId: "model-2",
    });
    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-2:complete",
      type: "bug",
      storyPoints: 5,
      modelId: "model-2",
    });
    expect(result).toEqual({
      success: true,
      data: {
        ...estimationResult,
        currentStage: estimationResult,
        fullyImplement: estimationResult,
        costCents: 125,
        predictedRemainingCostCents: 50,
        projectedTotalCostCents: 175,
        lowPredictedRemainingCostCents: 40,
        highPredictedRemainingCostCents: 60,
        lowProjectedTotalCostCents: 165,
        highProjectedTotalCostCents: 185,
      },
    });
  });

  it("getForWorkItem reports done items as having no remaining cost", async () => {
    const estimate = vi.fn();
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue({
        id: "wi-done",
        project_id: "proj-1",
        type: "task",
        status: "done",
        story_points: 3,
        cost_cents: 210,
        execution_config: { workflowId: "wf-1" },
      }),
    } as unknown as KanbanWorkItemRepository;
    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      dummyPricingClient,
      dummyPricingCache,
    );

    const result = await controller.getForWorkItem("proj-1", "wi-done");

    expect(estimate).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      costCents: 210,
      predictedRemainingCostCents: 0,
      projectedTotalCostCents: 210,
    });
  });

  it("getForWorkItem falls back to default agent model resolution when model is not set", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 1,
      estimatedCostCents: 50,
      lowCostCents: 40,
      highCostCents: 60,
      whatIf: [],
    };
    const estimate = vi.fn().mockResolvedValue(estimationResult);
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue({
        id: "wi-1",
        project_id: "proj-1",
        type: "bug",
        status: "in-progress",
        story_points: 5,
        cost_cents: 30,
        execution_config: { workflowId: "wf-2" }, // No model set
        assigned_agent_id: "senior_dev",
      }),
    } as unknown as KanbanWorkItemRepository;

    const resolveModel = vi.fn().mockResolvedValue({
      modelName: "MiniMax-M2.5-TEE",
      providerName: "MiniMaxAI",
    });
    const pricingClient = {
      resolveModel,
    } as unknown as CoreModelPricingClientService;

    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      pricingClient,
      dummyPricingCache,
    );

    const result = await controller.getForWorkItem("proj-1", "wi-1");

    expect(resolveModel).toHaveBeenCalledWith({
      agentProfileName: "senior_dev",
      scopeNodeId: "proj-1",
    });
    // m-1 is the mapped modelId in dummyPricingCache matching MiniMax-M2.5-TEE
    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-2",
      type: "bug",
      storyPoints: 5,
      modelId: "m-1",
    });
    expect(result).toEqual({
      success: true,
      data: {
        ...estimationResult,
        currentStage: estimationResult,
        fullyImplement: estimationResult,
        costCents: 30,
        predictedRemainingCostCents: 50,
        projectedTotalCostCents: 80,
        lowPredictedRemainingCostCents: 40,
        highPredictedRemainingCostCents: 60,
        lowProjectedTotalCostCents: 70,
        highProjectedTotalCostCents: 90,
      },
    });
  });

  it("getForWorkItem prefers a priced cache row when resolved model names are duplicated", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 1,
      estimatedCostCents: 50,
      lowCostCents: 40,
      highCostCents: 60,
      whatIf: [],
    };
    const estimate = vi.fn().mockResolvedValue(estimationResult);
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue({
        id: "wi-1",
        project_id: "proj-1",
        type: "story",
        status: "in-progress",
        story_points: 3,
        execution_config: { workflowId: "wf-2" },
        assigned_agent_id: "senior_dev",
      }),
    } as unknown as KanbanWorkItemRepository;
    const pricingClient = {
      resolveModel: vi.fn().mockResolvedValue({
        modelName: "MiniMax-M3",
        providerName: "MiniMaxAI",
      }),
    } as unknown as CoreModelPricingClientService;
    const pricingCache = {
      findAll: vi.fn().mockResolvedValue([
        {
          model_id: "minimax-m3-null",
          model_name: "MiniMax-M3",
          provider_name: "MiniMaxAI",
          input_token_cents_per_million: null,
          output_token_cents_per_million: null,
        },
        {
          model_id: "minimax-m3-priced",
          model_name: "MiniMax-M3",
          provider_name: "MiniMaxAI",
          input_token_cents_per_million: 15,
          output_token_cents_per_million: 60,
        },
      ]),
    } as unknown as KanbanModelPricingCacheRepository;
    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      pricingClient,
      pricingCache,
    );

    await controller.getForWorkItem("proj-1", "wi-1");

    expect(estimate).toHaveBeenCalledWith({
      workflowId: "wf-2",
      type: "story",
      storyPoints: 3,
      modelId: "minimax-m3-priced",
    });
  });

  it("getForWorkItem returns not found when the work item is missing", async () => {
    const estimate = vi.fn();
    const estimationService = {
      estimate,
    } as unknown as WorkItemCostEstimationService;
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue(null),
    } as unknown as KanbanWorkItemRepository;
    const controller = new WorkItemCostEstimationController(
      estimationService,
      workItems,
      dummyPricingClient,
      dummyPricingCache,
    );

    await expect(
      controller.getForWorkItem("proj-1", "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(estimate).not.toHaveBeenCalled();
  });
});
