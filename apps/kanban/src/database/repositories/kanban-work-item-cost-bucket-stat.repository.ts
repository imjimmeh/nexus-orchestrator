import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanWorkItemCostBucketStatEntity } from "../entities/kanban-work-item-cost-bucket-stat.entity";
import type {
  BucketKey,
  UpsertBucketInput,
} from "./kanban-work-item-cost-bucket-stat.repository.types";

@Injectable()
export class KanbanWorkItemCostBucketStatRepository {
  constructor(
    @InjectRepository(KanbanWorkItemCostBucketStatEntity)
    private readonly repository: Repository<KanbanWorkItemCostBucketStatEntity>,
  ) {}

  async upsertBucket(input: UpsertBucketInput): Promise<void> {
    await this.repository.upsert(
      {
        tier: input.tier,
        workflow_id: input.workflowId,
        type: input.type,
        story_points: input.storyPoints,
        sample_count: input.sampleCount,
        mean_input_tokens: input.meanInputTokens,
        p25_input_tokens: input.p25InputTokens,
        p75_input_tokens: input.p75InputTokens,
        mean_output_tokens: input.meanOutputTokens,
        p25_output_tokens: input.p25OutputTokens,
        p75_output_tokens: input.p75OutputTokens,
        mean_priced_turn_count: input.meanPricedTurnCount,
        p25_priced_turn_count: input.p25PricedTurnCount,
        p75_priced_turn_count: input.p75PricedTurnCount,
      },
      ["tier", "workflow_id", "type", "story_points"],
    );
  }

  findByKey(
    key: BucketKey,
  ): Promise<KanbanWorkItemCostBucketStatEntity | null> {
    const qb = this.repository
      .createQueryBuilder("s")
      .where("s.tier = :tier", { tier: key.tier })
      .andWhere("s.type = :type", { type: key.type });

    if (key.workflowId === null) {
      qb.andWhere("s.workflow_id IS NULL");
    } else {
      qb.andWhere("s.workflow_id = :workflowId", {
        workflowId: key.workflowId,
      });
    }

    if (key.storyPoints === null) {
      qb.andWhere("s.story_points IS NULL");
    } else {
      qb.andWhere("s.story_points = :storyPoints", {
        storyPoints: key.storyPoints,
      });
    }

    return qb.orderBy("s.computed_at", "DESC").getOne();
  }
}
