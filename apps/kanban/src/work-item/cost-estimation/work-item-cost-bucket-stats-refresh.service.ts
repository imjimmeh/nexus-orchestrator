import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { KanbanWorkItemRunCostRepository } from "../../database/repositories/kanban-work-item-run-cost.repository";
import { KanbanWorkItemCostBucketStatRepository } from "../../database/repositories/kanban-work-item-cost-bucket-stat.repository";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";
import { BUCKET_TIERS, computeTokenDistribution } from "./bucket-tiers";
import type {
  BucketAccumulator,
  WorkItemCostAttemptSample,
  WorkItemTotal,
} from "./work-item-cost-bucket-stats-refresh.service.types";

export type { WorkItemTotal } from "./work-item-cost-bucket-stats-refresh.service.types";

const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const GLOBAL_TYPE_KEY = "__all__";
type PollTimer = ReturnType<typeof setInterval>;

export function sumAttemptsPerWorkItem(
  attempts: WorkItemCostAttemptSample[],
): WorkItemTotal[] {
  const totals = new Map<string, WorkItemTotal>();

  for (const attempt of attempts) {
    if (!attempt.workflow_id) continue;
    const key = `${attempt.work_item_id}::${attempt.workflow_id}`;
    const existing = totals.get(key);
    if (existing) {
      existing.totalInputTokens += attempt.total_input_tokens;
      existing.totalOutputTokens += attempt.total_output_tokens;
      existing.pricedTurnCount += attempt.priced_turn_count;
      continue;
    }

    totals.set(key, {
      workItemId: attempt.work_item_id,
      workflowId: attempt.workflow_id,
      type: attempt.type,
      storyPoints: attempt.story_points,
      totalInputTokens: attempt.total_input_tokens,
      totalOutputTokens: attempt.total_output_tokens,
      pricedTurnCount: attempt.priced_turn_count,
    });
  }

  return Array.from(totals.values());
}

export function computeCostToCompleteSamples(
  attempts: WorkItemCostAttemptSample[],
  doneWorkItemIds: Set<string>,
): WorkItemTotal[] {
  const attemptsByItem = new Map<string, WorkItemCostAttemptSample[]>();
  for (const attempt of attempts) {
    if (!attempt.workflow_id) continue;
    if (!doneWorkItemIds.has(attempt.work_item_id)) continue;

    const list = attemptsByItem.get(attempt.work_item_id) ?? [];
    list.push(attempt);
    attemptsByItem.set(attempt.work_item_id, list);
  }

  const samples: WorkItemTotal[] = [];

  for (const [workItemId, itemList] of attemptsByItem.entries()) {
    itemList.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB;
    });

    const firstRunIndices = new Map<string, number>();
    for (let i = 0; i < itemList.length; i++) {
      const workflowId = itemList[i].workflow_id;
      if (workflowId && !firstRunIndices.has(workflowId)) {
        firstRunIndices.set(workflowId, i);
      }
    }

    for (const [workflowId, startIndex] of firstRunIndices.entries()) {
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let pricedTurnCount = 0;
      for (let i = startIndex; i < itemList.length; i++) {
        totalInputTokens += itemList[i].total_input_tokens;
        totalOutputTokens += itemList[i].total_output_tokens;
        pricedTurnCount += itemList[i].priced_turn_count;
      }

      const prototype = itemList[startIndex];
      samples.push({
        workItemId,
        workflowId: `${workflowId}:complete`,
        type: prototype.type,
        storyPoints: prototype.story_points,
        totalInputTokens,
        totalOutputTokens,
        pricedTurnCount,
      });
    }
  }

  return samples;
}

@Injectable()
export class WorkItemCostBucketStatsRefreshService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    WorkItemCostBucketStatsRefreshService.name,
  );
  private timer: PollTimer | null = null;

  constructor(
    private readonly runCosts: KanbanWorkItemRunCostRepository,
    private readonly bucketStats: KanbanWorkItemCostBucketStatRepository,
    private readonly workItemRepo: KanbanWorkItemRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshOnce();
    this.timer = setInterval(() => {
      void this.refreshOnce();
    }, this.readIntervalMs());
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshOnce(): Promise<void> {
    try {
      const attempts = await this.runCosts.findAllForBucketAggregation();
      const stageSamples = sumAttemptsPerWorkItem(attempts);

      const itemIds = stageSamples.map((t) => t.workItemId).filter(Boolean);
      const items =
        itemIds.length > 0 ? await this.workItemRepo.findByIds(itemIds) : [];
      const doneItemIds = new Set<string>(
        items
          .filter((i: KanbanWorkItemEntity) => i.status === "done")
          .map((i: KanbanWorkItemEntity) => i.id),
      );

      const ctcSamples = computeCostToCompleteSamples(attempts, doneItemIds);
      const extendedTotals: WorkItemTotal[] = [...stageSamples, ...ctcSamples];

      for (const tier of BUCKET_TIERS) {
        const groups = new Map<string, BucketAccumulator>();

        for (const total of extendedTotals) {
          const workflowId = tier.usesWorkflow ? total.workflowId : null;
          const type = tier.name === "global" ? GLOBAL_TYPE_KEY : total.type;
          const storyPoints = tier.usesStoryPoints ? total.storyPoints : null;
          const key = `${workflowId ?? ""}::${type}::${storyPoints ?? ""}`;

          const group = groups.get(key) ?? {
            workflowId,
            type,
            storyPoints,
            inputTokens: [],
            outputTokens: [],
            pricedTurnCounts: [],
          };
          group.inputTokens.push(total.totalInputTokens);
          group.outputTokens.push(total.totalOutputTokens);
          group.pricedTurnCounts.push(total.pricedTurnCount);
          groups.set(key, group);
        }

        for (const group of groups.values()) {
          const inputDist = computeTokenDistribution(group.inputTokens);
          const outputDist = computeTokenDistribution(group.outputTokens);
          const pricedTurnDist = computeTokenDistribution(
            group.pricedTurnCounts,
          );

          await this.bucketStats.upsertBucket({
            tier: tier.name,
            workflowId: group.workflowId,
            type: group.type,
            storyPoints: group.storyPoints,
            sampleCount: inputDist.n,
            meanInputTokens: inputDist.mean,
            p25InputTokens: inputDist.p25,
            p75InputTokens: inputDist.p75,
            meanOutputTokens: outputDist.mean,
            p25OutputTokens: outputDist.p25,
            p75OutputTokens: outputDist.p75,
            meanPricedTurnCount: pricedTurnDist.mean,
            p25PricedTurnCount: pricedTurnDist.p25,
            p75PricedTurnCount: pricedTurnDist.p75,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to refresh work item cost bucket stats: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readIntervalMs(): number {
    const raw = process.env.KANBAN_COST_BUCKET_REFRESH_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_REFRESH_INTERVAL_MS;
  }
}
