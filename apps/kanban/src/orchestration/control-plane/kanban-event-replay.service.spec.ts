import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CoreWorkflowClientService } from "../../core/core-workflow-client.service";
import { KanbanEventDeliveryProjectionEntity } from "../../database/entities/kanban-event-delivery-projection.entity";
import { KanbanEventDeliveryProjectionRepository } from "../../database/repositories/kanban-event-delivery-projection.repository";
import { KanbanEventReplayService } from "./kanban-event-replay.service";

function createService() {
  const projections = {
    findByEventId: vi.fn(),
    markReplayAttempt: vi.fn(),
  };
  const coreClient = {
    emitDomainEventOrThrow: vi.fn(),
  };

  return {
    coreClient,
    projections,
    service: new KanbanEventReplayService(
      projections as unknown as KanbanEventDeliveryProjectionRepository,
      coreClient as unknown as CoreWorkflowClientService,
    ),
  };
}

describe("KanbanEventReplayService", () => {
  it("throws when the event projection does not exist", async () => {
    const { coreClient, projections, service } = createService();
    projections.findByEventId.mockResolvedValue(null);

    await expect(service.replayEvent("event-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(projections.markReplayAttempt).not.toHaveBeenCalled();
    expect(coreClient.emitDomainEventOrThrow).not.toHaveBeenCalled();
  });

  it("records replay attempt before emitting the stored event through Core", async () => {
    const { coreClient, projections, service } = createService();
    const event = buildProjection();
    projections.findByEventId.mockResolvedValue(event);
    projections.markReplayAttempt.mockResolvedValue(undefined);
    coreClient.emitDomainEventOrThrow.mockResolvedValue(undefined);

    const result = await service.replayEvent("event-1");

    expect(result).toEqual({ replayed: true });
    expect(projections.markReplayAttempt).toHaveBeenCalledWith(
      "event-1",
      expect.any(Date),
    );
    expect(coreClient.emitDomainEventOrThrow).toHaveBeenCalledWith({
      eventName: "kanban.work_item.status_changed.v1",
      payload: { event: "status_changed", workItemId: "item-1" },
      eventId: "event-1",
    });
    expect(
      projections.markReplayAttempt.mock.invocationCallOrder[0],
    ).toBeLessThan(
      coreClient.emitDomainEventOrThrow.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

function buildProjection(
  overrides: Partial<KanbanEventDeliveryProjectionEntity> = {},
): KanbanEventDeliveryProjectionEntity {
  return {
    id: "projection-1",
    event_id: "event-1",
    event_name: "kanban.work_item.status_changed.v1",
    project_id: "project-1",
    work_item_id: "item-1",
    workflow_run_id: null,
    dedupe_key: "dedupe-1",
    status: "failed",
    replay_count: 0,
    last_attempted_at: null,
    accepted_at: null,
    last_error: "Core unavailable",
    payload_snapshot: { event: "status_changed", workItemId: "item-1" },
    metadata: null,
    created_at: new Date("2026-05-18T21:00:00.000Z"),
    updated_at: new Date("2026-05-18T21:00:00.000Z"),
    ...overrides,
  };
}
