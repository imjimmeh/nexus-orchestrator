import { Injectable, NotFoundException } from "@nestjs/common";
import { CoreWorkflowClientService } from "../../core/core-workflow-client.service";
import { KanbanEventDeliveryProjectionRepository } from "../../database/repositories/kanban-event-delivery-projection.repository";

@Injectable()
export class KanbanEventReplayService {
  constructor(
    private readonly projections: KanbanEventDeliveryProjectionRepository,
    private readonly coreClient: CoreWorkflowClientService,
  ) {}

  async replayEvent(eventId: string): Promise<{ replayed: true }> {
    const event = await this.projections.findByEventId(eventId);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);

    await this.projections.markReplayAttempt(eventId, new Date());
    await this.coreClient.emitDomainEventOrThrow({
      eventName: event.event_name,
      payload: event.payload_snapshot,
      eventId: event.event_id,
    });

    return { replayed: true };
  }
}
