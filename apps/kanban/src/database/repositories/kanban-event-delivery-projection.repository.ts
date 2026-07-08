import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanEventDeliveryProjectionEntity } from "../entities/kanban-event-delivery-projection.entity";
import type { UpsertKanbanEventDeliveryProjectionInput } from "./kanban-event-delivery-projection.types";

@Injectable()
export class KanbanEventDeliveryProjectionRepository {
  constructor(
    @InjectRepository(KanbanEventDeliveryProjectionEntity)
    private readonly repository: Repository<KanbanEventDeliveryProjectionEntity>,
  ) {}

  async recordPending(
    input: UpsertKanbanEventDeliveryProjectionInput,
  ): Promise<KanbanEventDeliveryProjectionEntity> {
    const existing = await this.repository.findOne({
      where: { event_id: input.eventId },
    });
    if (existing) return existing;

    return this.repository.save(
      this.repository.create({
        event_id: input.eventId,
        event_name: input.eventName,
        project_id: input.projectId ?? null,
        work_item_id: input.workItemId ?? null,
        workflow_run_id: input.workflowRunId ?? null,
        dedupe_key: input.dedupeKey ?? null,
        status: "pending",
        replay_count: 0,
        last_attempted_at: new Date(),
        accepted_at: null,
        last_error: null,
        payload_snapshot: input.payloadSnapshot,
        metadata: input.metadata ?? null,
      }),
    );
  }

  async markAccepted(eventId: string, acceptedAt: Date): Promise<void> {
    await this.repository.update(
      { event_id: eventId },
      { status: "accepted", accepted_at: acceptedAt, last_error: null },
    );
  }

  async markFailed(
    eventId: string,
    error: string,
    attemptedAt: Date,
  ): Promise<void> {
    await this.repository.update(
      { event_id: eventId },
      { status: "failed", last_error: error, last_attempted_at: attemptedAt },
    );
  }

  async markReplayAttempt(eventId: string, attemptedAt: Date): Promise<void> {
    await this.repository.increment({ event_id: eventId }, "replay_count", 1);
    await this.repository.update(
      { event_id: eventId },
      { status: "replayed", last_attempted_at: attemptedAt },
    );
  }

  findByEventId(
    eventId: string,
  ): Promise<KanbanEventDeliveryProjectionEntity | null> {
    return this.repository.findOne({ where: { event_id: eventId } });
  }

  listByProject(
    projectId: string,
  ): Promise<KanbanEventDeliveryProjectionEntity[]> {
    return this.repository.find({
      where: { project_id: projectId },
      order: { created_at: "DESC" },
    });
  }
}
