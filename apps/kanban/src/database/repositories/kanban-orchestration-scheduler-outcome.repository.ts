import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "../entities/kanban-orchestration-scheduler-outcome.entity";
import type {
  OrchestrationConflictKey,
  SchedulerOutcomeReason,
  SchedulerOutcomeStatus,
} from "../../orchestration/control-plane/control-plane.types";

interface RecordSchedulerOutcomeInput {
  readonly intentId: string;
  readonly projectId: string;
  readonly status: SchedulerOutcomeStatus;
  readonly reason: SchedulerOutcomeReason;
  readonly conflictKeys: OrchestrationConflictKey[];
  readonly activeConflicts: OrchestrationConflictKey[];
  readonly evaluatedAt: Date;
  readonly policySnapshot: Record<string, unknown>;
  readonly metadata?: Record<string, unknown> | null;
}

@Injectable()
export class KanbanOrchestrationSchedulerOutcomeRepository {
  constructor(
    @InjectRepository(KanbanOrchestrationSchedulerOutcomeEntity)
    private readonly repository: Repository<KanbanOrchestrationSchedulerOutcomeEntity>,
  ) {}

  recordOutcome(
    input: RecordSchedulerOutcomeInput,
  ): Promise<KanbanOrchestrationSchedulerOutcomeEntity> {
    return this.repository.save(
      this.repository.create({
        intent_id: input.intentId,
        project_id: input.projectId,
        status: input.status,
        reason: input.reason,
        conflict_keys: input.conflictKeys,
        active_conflicts: input.activeConflicts,
        evaluated_at: input.evaluatedAt,
        policy_snapshot: input.policySnapshot,
        metadata: input.metadata ?? null,
      }),
    );
  }

  listByIntent(
    intentId: string,
  ): Promise<KanbanOrchestrationSchedulerOutcomeEntity[]> {
    return this.repository.find({
      where: { intent_id: intentId },
      order: { created_at: "DESC" },
    });
  }
}
