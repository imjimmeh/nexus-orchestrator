import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";
import type { CostEstimateInput } from "./work-item-cost-estimation.types";
import { CoreModelPricingClientService } from "../../core/core-model-pricing-client.service";
import { KanbanModelPricingCacheRepository } from "../../database/repositories/kanban-model-pricing-cache.repository";

export function getStageWorkflowId(status: string): string {
  switch (status) {
    case "refinement":
      return "work_item_refinement_default";
    case "in-review":
      return "work_item_in_review_default";
    case "ready-to-merge":
      return "work_item_ready_to_merge_default";
    case "in-progress":
    case "todo":
    case "backlog":
    default:
      return "work_item_in_progress_default";
  }
}

@Controller("work-items")
export class WorkItemCostEstimationController {
  private readonly logger = new Logger(WorkItemCostEstimationController.name);

  constructor(
    private readonly estimationService: WorkItemCostEstimationService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly pricingClient: CoreModelPricingClientService,
    private readonly pricingCache: KanbanModelPricingCacheRepository,
  ) {}

  @Post("cost-estimate/preview")
  async preview(@Body() body: CostEstimateInput) {
    const resolvedModelId = await this.resolveModelId(body.modelId, null, null);

    const currentStage = await this.estimationService.estimate({
      ...body,
      modelId: resolvedModelId,
    });
    const fullyImplement = await this.estimationService.estimate({
      ...body,
      workflowId: body.workflowId ? `${body.workflowId}:complete` : null,
      modelId: resolvedModelId,
    });
    return {
      success: true,
      data: {
        ...currentStage,
        currentStage,
        fullyImplement,
      },
    };
  }

  @Get(":projectId/:id/cost-estimate")
  async getForWorkItem(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    const item = await this.workItems.findByProjectAndId(projectId, id);
    if (!item) {
      throw new NotFoundException(`Work item ${id} not found`);
    }

    if (item.status === "done") {
      const emptyEstimate = {
        available: true,
        bucketTier: null,
        sampleCount: 0,
        estimatedCostCents: 0,
        lowCostCents: 0,
        highCostCents: 0,
        whatIf: [],
      };

      return {
        success: true,
        data: {
          ...emptyEstimate,
          currentStage: emptyEstimate,
          fullyImplement: emptyEstimate,
          ...buildProjectionFields(item.cost_cents, emptyEstimate),
        },
      };
    }

    const executionConfig = item.execution_config ?? {};
    const workflowId =
      readOptionalString(executionConfig.workflowId) ??
      getStageWorkflowId(item.status);
    const modelId = readOptionalString(executionConfig.model);
    const agentProfileId = readOptionalString(executionConfig.agentProfileId);

    const resolvedModelId = await this.resolveModelId(
      modelId,
      agentProfileId,
      item.assigned_agent_id,
      projectId,
    );

    const currentStage = await this.estimationService.estimate({
      workflowId,
      type: item.type,
      storyPoints: item.story_points,
      modelId: resolvedModelId,
    });

    const fullyImplement = await this.estimationService.estimate({
      workflowId: workflowId ? `${workflowId}:complete` : null,
      type: item.type,
      storyPoints: item.story_points,
      modelId: resolvedModelId,
    });

    return {
      success: true,
      data: {
        ...currentStage,
        currentStage,
        fullyImplement,
        ...buildProjectionFields(item.cost_cents, fullyImplement),
      },
    };
  }

  private async resolveModelId(
    modelId: string | null,
    agentProfileId: string | null,
    assignedAgentId: string | null,
    projectId?: string,
  ): Promise<string | null> {
    if (modelId) {
      return modelId;
    }

    const agentProfileName = agentProfileId ?? assignedAgentId ?? "senior_dev";
    try {
      const resolved = await this.pricingClient.resolveModel({
        agentProfileName,
        scopeNodeId: projectId,
      });

      if (resolved && resolved.modelName) {
        const modelNameLower = resolved.modelName.toLowerCase();
        const providerNameLower = resolved.providerName?.toLowerCase();
        const rates = await this.pricingCache.findAll();
        const modelMatches = rates.filter(
          (rate) => rate.model_name.toLowerCase() === modelNameLower,
        );
        const providerMatches = providerNameLower
          ? modelMatches.filter(
              (rate) => rate.provider_name?.toLowerCase() === providerNameLower,
            )
          : [];
        const candidates =
          providerMatches.length > 0 ? providerMatches : modelMatches;
        const matchedRate =
          candidates.find(
            (rate) =>
              rate.input_token_cents_per_million !== null &&
              rate.output_token_cents_per_million !== null,
          ) ?? candidates[0];
        if (matchedRate) {
          return matchedRate.model_id;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to resolve default model for agent ${agentProfileName}: ${errMsg}`,
      );
    }

    return null;
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildProjectionFields(
  costCents: number,
  remaining: {
    available: boolean;
    estimatedCostCents: number | null;
    lowCostCents: number | null;
    highCostCents: number | null;
  },
) {
  const predictedRemainingCostCents = remaining.available
    ? remaining.estimatedCostCents
    : null;
  const lowPredictedRemainingCostCents = remaining.available
    ? remaining.lowCostCents
    : null;
  const highPredictedRemainingCostCents = remaining.available
    ? remaining.highCostCents
    : null;

  return {
    costCents,
    predictedRemainingCostCents,
    projectedTotalCostCents:
      predictedRemainingCostCents === null
        ? null
        : costCents + predictedRemainingCostCents,
    lowPredictedRemainingCostCents,
    highPredictedRemainingCostCents,
    lowProjectedTotalCostCents:
      lowPredictedRemainingCostCents === null
        ? null
        : costCents + lowPredictedRemainingCostCents,
    highProjectedTotalCostCents:
      highPredictedRemainingCostCents === null
        ? null
        : costCents + highPredictedRemainingCostCents,
  };
}
