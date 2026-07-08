import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanWorkItemRunCostEntity } from "../entities/kanban-work-item-run-cost.entity";
import type { RecordRunCostAttemptInput } from "./kanban-work-item-run-cost.repository.types";

@Injectable()
export class KanbanWorkItemRunCostRepository {
  constructor(
    @InjectRepository(KanbanWorkItemRunCostEntity)
    private readonly repository: Repository<KanbanWorkItemRunCostEntity>,
  ) {}

  /**
   * Idempotent on `run_id` — a redelivered lifecycle event must not double-count
   * an attempt. attempt_number/is_retry are derived from how many prior
   * terminal attempts this work item already has recorded.
   */
  async recordAttempt(
    input: RecordRunCostAttemptInput,
  ): Promise<{ inserted: boolean }> {
    const existing = await this.repository.findOne({
      where: { run_id: input.run_id },
    });
    if (existing) {
      return { inserted: false };
    }

    const priorAttempts = await this.repository.count({
      where: { work_item_id: input.work_item_id },
    });
    const attemptNumber = priorAttempts + 1;

    await this.repository.save(
      this.repository.create({
        ...input,
        attempt_number: attemptNumber,
        is_retry: attemptNumber > 1,
      }),
    );

    return { inserted: true };
  }

  findAllForBucketAggregation(): Promise<KanbanWorkItemRunCostEntity[]> {
    return this.repository.find();
  }
}
