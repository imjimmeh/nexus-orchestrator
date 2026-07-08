import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanEventDeliveryProjectionEntity } from "../entities/kanban-event-delivery-projection.entity";
import { KanbanEventDeliveryProjectionRepository } from "./kanban-event-delivery-projection.repository";

type MockRepository = {
  create: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  increment: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createRepository() {
  const typeOrmRepository = {
    create: vi.fn((entity) => entity as KanbanEventDeliveryProjectionEntity),
    findOne: vi.fn(),
    find: vi.fn(),
    increment: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanEventDeliveryProjectionRepository(
      typeOrmRepository as unknown as Repository<KanbanEventDeliveryProjectionEntity>,
    ),
  };
}

describe("KanbanEventDeliveryProjectionRepository", () => {
  it("recordPending returns an existing projection for the same event ID", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const existing = {
      id: "projection-1",
      event_id: "event-1",
      status: "pending",
    } as KanbanEventDeliveryProjectionEntity;
    typeOrmRepository.findOne.mockResolvedValue(existing);

    const result = await repository.recordPending({
      eventId: "event-1",
      eventName: "kanban.work_item.status_changed.v1",
      payloadSnapshot: { event: "status_changed" },
    });

    expect(result).toBe(existing);
    expect(typeOrmRepository.save).not.toHaveBeenCalled();
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { event_id: "event-1" },
    });
  });

  it("recordPending creates a pending projection with nullable context defaults", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const saved = { id: "projection-1" } as KanbanEventDeliveryProjectionEntity;
    typeOrmRepository.findOne.mockResolvedValue(null);
    typeOrmRepository.save.mockResolvedValue(saved);

    const result = await repository.recordPending({
      eventId: "event-1",
      eventName: "kanban.work_item.status_changed.v1",
      projectId: "project-1",
      workItemId: "item-1",
      dedupeKey: "dedupe-1",
      payloadSnapshot: { event: "status_changed" },
    });

    expect(result).toBe(saved);
    expect(typeOrmRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: "event-1",
        event_name: "kanban.work_item.status_changed.v1",
        project_id: "project-1",
        work_item_id: "item-1",
        workflow_run_id: null,
        dedupe_key: "dedupe-1",
        status: "pending",
        replay_count: 0,
        accepted_at: null,
        last_error: null,
        payload_snapshot: { event: "status_changed" },
        metadata: null,
      }),
    );
    expect(
      typeOrmRepository.create.mock.calls[0]?.[0].last_attempted_at,
    ).toBeInstanceOf(Date);
    expect(typeOrmRepository.save).toHaveBeenCalledWith(
      typeOrmRepository.create.mock.results[0]?.value,
    );
  });

  it("markAccepted records accepted status and clears the last error", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const acceptedAt = new Date("2026-05-18T21:00:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markAccepted("event-1", acceptedAt);

    expect(typeOrmRepository.update).toHaveBeenCalledWith(
      { event_id: "event-1" },
      { status: "accepted", accepted_at: acceptedAt, last_error: null },
    );
  });

  it("markFailed records failed status, error, and attempted timestamp", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const attemptedAt = new Date("2026-05-18T21:05:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markFailed("event-1", "Core unavailable", attemptedAt);

    expect(typeOrmRepository.update).toHaveBeenCalledWith(
      { event_id: "event-1" },
      {
        status: "failed",
        last_error: "Core unavailable",
        last_attempted_at: attemptedAt,
      },
    );
  });

  it("markReplayAttempt increments replay count before recording replay status", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const attemptedAt = new Date("2026-05-18T21:10:00.000Z");
    typeOrmRepository.increment.mockResolvedValue({ affected: 1, raw: [] });
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markReplayAttempt("event-1", attemptedAt);

    expect(typeOrmRepository.increment).toHaveBeenCalledWith(
      { event_id: "event-1" },
      "replay_count",
      1,
    );
    expect(typeOrmRepository.update).toHaveBeenCalledWith(
      { event_id: "event-1" },
      { status: "replayed", last_attempted_at: attemptedAt },
    );
    expect(
      typeOrmRepository.increment.mock.invocationCallOrder[0],
    ).toBeLessThan(typeOrmRepository.update.mock.invocationCallOrder[0] ?? 0);
  });

  it("findByEventId queries by event_id", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const existing = {
      id: "projection-1",
    } as KanbanEventDeliveryProjectionEntity;
    typeOrmRepository.findOne.mockResolvedValue(existing);

    const result = await repository.findByEventId("event-1");

    expect(result).toBe(existing);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { event_id: "event-1" },
    });
  });

  it("listByProject orders project projections by creation time descending", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const rows = [
      { id: "projection-1" },
    ] as KanbanEventDeliveryProjectionEntity[];
    typeOrmRepository.find.mockResolvedValue(rows);

    const result = await repository.listByProject("project-1");

    expect(result).toBe(rows);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "DESC" },
    });
  });
});
