import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanRetrospectiveRunEntity } from "../entities/kanban-retrospective-run.entity";
import { KanbanRetrospectiveRunRepository } from "./kanban-retrospective-run.repository";

type MockRepository = Pick<
  Repository<KanbanRetrospectiveRunEntity>,
  "save" | "findOne" | "find" | "update"
>;

function createRepository() {
  const typeOrmRepository = {
    save: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    update: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanRetrospectiveRunRepository(
      typeOrmRepository as unknown as Repository<KanbanRetrospectiveRunEntity>,
    ),
  };
}

describe("KanbanRetrospectiveRunRepository", () => {
  it("createRun saves a running row with idempotency key, project id, trigger type, and timestamps", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const savedRun = { id: "run-1" } as KanbanRetrospectiveRunEntity;
    const startedAt = new Date("2026-05-16T10:00:00.000Z");
    typeOrmRepository.save.mockResolvedValue(savedRun);

    const result = await repository.createRun({
      idempotency_key: "retrospective:project-1:marker-1",
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_type: "completion_event",
      trigger_revision_marker: "marker-1",
      started_at: startedAt,
    });

    expect(result).toBe(savedRun);
    expect(typeOrmRepository.save).toHaveBeenCalledWith({
      idempotency_key: "retrospective:project-1:marker-1",
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_type: "completion_event",
      trigger_revision_marker: "marker-1",
      replay_of_run_id: null,
      status: "running",
      skip_reason: null,
      failure_reason: null,
      candidate_count: 0,
      learning_candidate_ids: [],
      delta_snapshot_json: null,
      diagnostics_json: null,
      started_at: startedAt,
      completed_at: null,
    });
  });

  it("findByIdempotencyKey returns an existing run", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const existingRun = { id: "run-1" } as KanbanRetrospectiveRunEntity;
    typeOrmRepository.findOne.mockResolvedValue(existingRun);

    const result = await repository.findByIdempotencyKey(
      "retrospective:project-1:marker-1",
    );

    expect(result).toBe(existingRun);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { idempotency_key: "retrospective:project-1:marker-1" },
    });
  });

  it("findLatestByProject filters by project_id and orders created_at DESC", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const existingRun = { id: "run-1" } as KanbanRetrospectiveRunEntity;
    typeOrmRepository.findOne.mockResolvedValue(existingRun);

    const result = await repository.findLatestByProject("project-1");

    expect(result).toBe(existingRun);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { project_id: "project-1" },
      order: { created_at: "DESC" },
    });
  });

  it("findLatestCompletedByProject filters by project_id and completed status", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const existingRun = { id: "run-1" } as KanbanRetrospectiveRunEntity;
    typeOrmRepository.findOne.mockResolvedValue(existingRun);

    const result = await repository.findLatestCompletedByProject("project-1");

    expect(result).toBe(existingRun);
    expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
      where: { project_id: "project-1", status: "completed" },
      order: { completed_at: "DESC", created_at: "DESC" },
    });
  });

  it("list supports projectId, status, limit, and offset filters", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const runs = [{ id: "run-1" }] as KanbanRetrospectiveRunEntity[];
    typeOrmRepository.find.mockResolvedValue(runs);

    const result = await repository.list({
      projectId: "project-1",
      status: "completed",
      limit: 25,
      offset: 50,
    });

    expect(result).toBe(runs);
    expect(typeOrmRepository.find).toHaveBeenCalledWith({
      where: { project_id: "project-1", status: "completed" },
      order: { created_at: "DESC" },
      take: 25,
      skip: 50,
    });
  });

  it("markCompleted writes completion fields", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const completedAt = new Date("2026-05-16T11:00:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markCompleted("run-1", {
      candidate_count: 2,
      learning_candidate_ids: ["candidate-1", "candidate-2"],
      delta_snapshot_json: { completed: true },
      diagnostics_json: { elapsedMs: 1234 },
      completed_at: completedAt,
    });

    expect(typeOrmRepository.update).toHaveBeenCalledWith("run-1", {
      status: "completed",
      candidate_count: 2,
      learning_candidate_ids: ["candidate-1", "candidate-2"],
      delta_snapshot_json: { completed: true },
      diagnostics_json: { elapsedMs: 1234 },
      completed_at: completedAt,
    });
  });

  it("markSkipped writes skip fields", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const completedAt = new Date("2026-05-16T11:00:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markSkipped("run-1", {
      skip_reason: "no_delta",
      diagnostics_json: { reason: "nothing changed" },
      completed_at: completedAt,
    });

    expect(typeOrmRepository.update).toHaveBeenCalledWith("run-1", {
      status: "skipped",
      skip_reason: "no_delta",
      diagnostics_json: { reason: "nothing changed" },
      completed_at: completedAt,
    });
  });

  it("markFailed writes failure fields", async () => {
    const { repository, typeOrmRepository } = createRepository();
    const completedAt = new Date("2026-05-16T11:00:00.000Z");
    typeOrmRepository.update.mockResolvedValue({ affected: 1, raw: [] });

    await repository.markFailed("run-1", {
      failure_reason: "model unavailable",
      diagnostics_json: { provider: "openai" },
      completed_at: completedAt,
    });

    expect(typeOrmRepository.update).toHaveBeenCalledWith("run-1", {
      status: "failed",
      failure_reason: "model unavailable",
      diagnostics_json: { provider: "openai" },
      completed_at: completedAt,
    });
  });
});
