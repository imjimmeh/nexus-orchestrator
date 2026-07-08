import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanOrchestrationLaunchAttemptEntity } from "../entities/kanban-orchestration-launch-attempt.entity";
import type {
  LaunchAttemptStatus,
  RecordLaunchAttemptInput,
} from "../../orchestration/control-plane/control-plane.types";

@Injectable()
export class KanbanOrchestrationLaunchAttemptRepository {
  constructor(
    @InjectRepository(KanbanOrchestrationLaunchAttemptEntity)
    private readonly repository: Repository<KanbanOrchestrationLaunchAttemptEntity>,
  ) {}

  recordAttempt(
    input: RecordLaunchAttemptInput,
  ): Promise<KanbanOrchestrationLaunchAttemptEntity> {
    return this.repository.save(
      this.repository.create({
        intent_id: input.intentId,
        outcome_id: input.outcomeId ?? null,
        project_id: input.projectId,
        workflow_id: input.workflowId,
        workflow_scope: input.workflowScope ?? null,
        workflow_run_id: input.workflowRunId ?? null,
        idempotency_key: input.idempotencyKey,
        status: input.status,
        requested_at: input.requestedAt ?? new Date(),
        completed_at: input.completedAt ?? null,
        failure_reason: input.failureReason ?? null,
        response_payload: input.responsePayload ?? null,
        metadata: input.metadata ?? null,
      }),
    );
  }

  async markCompleted(
    id: string,
    status: Exclude<LaunchAttemptStatus, "requested">,
    workflowRunId: string | null,
    completedAt: Date,
    responsePayload?: Record<string, unknown> | null,
    failureReason?: string | null,
  ): Promise<void> {
    const query = this.repository
      .createQueryBuilder()
      .update(KanbanOrchestrationLaunchAttemptEntity)
      .set({
        status,
        workflow_run_id: workflowRunId,
        completed_at: completedAt,
        response_payload:
          responsePayload === null || responsePayload === undefined
            ? () => "NULL"
            : () => "CAST(:responsePayload AS jsonb)",
        failure_reason: failureReason ?? null,
      })
      .where("id = :id", { id });

    if (responsePayload !== null && responsePayload !== undefined) {
      query.setParameter("responsePayload", JSON.stringify(responsePayload));
    }

    await query.execute();
  }

  listByIntent(
    intentId: string,
  ): Promise<KanbanOrchestrationLaunchAttemptEntity[]> {
    return this.repository.find({
      where: { intent_id: intentId },
      order: { created_at: "DESC" },
    });
  }
}
