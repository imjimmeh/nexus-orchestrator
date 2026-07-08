import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { KanbanOrchestrationIntentEntity } from "../entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationIntentRepository } from "./kanban-orchestration-intent.repository";
import type {
  CreateOrchestrationIntentInput,
  OrchestrationIntentStatus,
} from "../../orchestration/control-plane/control-plane.types";

type MockRepository = Pick<
  Repository<KanbanOrchestrationIntentEntity>,
  "findOne" | "save" | "create" | "update" | "find"
>;

function createRepository() {
  const typeOrmRepository = {
    findOne: vi.fn(),
    save: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ affected: 0 }),
    find: vi.fn(),
  } satisfies MockRepository;

  return {
    typeOrmRepository,
    repository: new KanbanOrchestrationIntentRepository(
      typeOrmRepository as unknown as Repository<KanbanOrchestrationIntentEntity>,
    ),
  };
}

function makeIntentEntity(
  overrides: Partial<KanbanOrchestrationIntentEntity> = {},
): KanbanOrchestrationIntentEntity {
  return {
    id: "intent-1",
    project_id: "project-1",
    lane: "strategy",
    type: "validate_project_health",
    status: "pending",
    requester: "test",
    reason: "test reason",
    priority: 0,
    evidence: [],
    resource_refs: [],
    conflict_keys: [],
    workflow_id: null,
    workflow_scope: null,
    idempotency_key: "test-key-1",
    supersedes_intent_id: null,
    freshness_requirements: {},
    terminal_outcome: null,
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeIntentInput(
  overrides: Partial<CreateOrchestrationIntentInput> = {},
): CreateOrchestrationIntentInput {
  return {
    projectId: "project-1",
    lane: "strategy",
    type: "validate_project_health",
    requester: "test",
    reason: "test reason",
    conflictKeys: [],
    idempotencyKey: "test-key-1",
    ...overrides,
  };
}

describe("KanbanOrchestrationIntentRepository", () => {
  describe("createIntent", () => {
    it("returns existing non-terminal intent by idempotency key", async () => {
      const { repository, typeOrmRepository } = createRepository();
      const existing = makeIntentEntity({
        idempotency_key: "test-key-1",
        status: "pending",
      });
      typeOrmRepository.findOne.mockResolvedValue(existing);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(existing);
      expect(typeOrmRepository.save).not.toHaveBeenCalled();
    });

    it.each(["launchable", "running"] satisfies OrchestrationIntentStatus[])(
      "returns existing %s intent (non-terminal)",
      async (status) => {
        const { repository, typeOrmRepository } = createRepository();
        const existing = makeIntentEntity({
          idempotency_key: "test-key-1",
          status,
        });
        typeOrmRepository.findOne.mockResolvedValue(existing);

        const result = await repository.createIntent(makeIntentInput());

        expect(result).toBe(existing);
        expect(typeOrmRepository.save).not.toHaveBeenCalled();
      },
    );

    it("skips existing blocked intent and creates a new one with deduped key", async () => {
      const { repository, typeOrmRepository } = createRepository();
      const existing = makeIntentEntity({
        idempotency_key: "test-key-1",
        status: "blocked",
      });
      typeOrmRepository.findOne.mockResolvedValueOnce(existing);

      const newIntent = makeIntentEntity({
        id: "intent-2",
        idempotency_key: "test-key-1:9999999999999",
      });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(newIntent);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: expect.stringMatching(/^test-key-1:\d+$/),
        }),
      );
    });

    it("skips existing suppressed intent and creates a new one with deduped key", async () => {
      const { repository, typeOrmRepository } = createRepository();
      const existing = makeIntentEntity({
        idempotency_key: "test-key-1",
        status: "suppressed",
      });
      typeOrmRepository.findOne.mockResolvedValueOnce(existing);

      const newIntent = makeIntentEntity({
        id: "intent-2",
        idempotency_key: "test-key-1:8888888888888",
      });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(newIntent);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: expect.stringMatching(/^test-key-1:\d+$/),
        }),
      );
    });

    it("skips existing completed intent and creates a new one with deduped key", async () => {
      const { repository, typeOrmRepository } = createRepository();
      const existing = makeIntentEntity({
        idempotency_key: "test-key-1",
        status: "completed",
      });
      typeOrmRepository.findOne.mockResolvedValueOnce(existing);

      const newIntent = makeIntentEntity({
        id: "intent-2",
        idempotency_key: "test-key-1:6666666666666",
      });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(newIntent);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: expect.stringMatching(/^test-key-1:\d+$/),
        }),
      );
    });

    it("creates new intent when no existing intent found", async () => {
      const { repository, typeOrmRepository } = createRepository();
      typeOrmRepository.findOne.mockResolvedValue(null);

      const newIntent = makeIntentEntity({ id: "intent-new" });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(newIntent);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotency_key: "test-key-1" }),
      );
    });

    it("does not resurrect terminal intent via unique constraint error", async () => {
      const { repository, typeOrmRepository } = createRepository();
      // First lookup: existing blocked intent
      const blocked = makeIntentEntity({
        idempotency_key: "test-key-1",
        status: "blocked",
      });
      typeOrmRepository.findOne.mockResolvedValueOnce(blocked);

      // Deduped key should not exist
      typeOrmRepository.findOne.mockResolvedValueOnce(null);

      const newIntent = makeIntentEntity({
        id: "intent-2",
        idempotency_key: "test-key-1:7777777777777",
      });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(makeIntentInput());

      expect(result).toBe(newIntent);
      expect(result.id).toBe("intent-2");
    });

    it("uses idempotencyKey from input when provided", async () => {
      const { repository, typeOrmRepository } = createRepository();
      typeOrmRepository.findOne.mockResolvedValue(null);

      const newIntent = makeIntentEntity({ idempotency_key: "custom-key" });
      typeOrmRepository.create.mockReturnValue(newIntent);
      typeOrmRepository.save.mockResolvedValue(newIntent);

      const result = await repository.createIntent(
        makeIntentInput({ idempotencyKey: "custom-key" }),
      );

      expect(result).toBe(newIntent);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotency_key: "custom-key" }),
      );
    });
  });

  describe("updateStatus", () => {
    it("updates status and terminal_outcome", async () => {
      const { repository, typeOrmRepository } = createRepository();

      await repository.updateStatus("intent-1", "blocked", "suppressed");

      expect(typeOrmRepository.update).toHaveBeenCalledWith("intent-1", {
        status: "blocked",
        terminal_outcome: "suppressed",
      });
    });

    it("sets terminal_outcome to null when not provided", async () => {
      const { repository, typeOrmRepository } = createRepository();

      await repository.updateStatus("intent-1", "launchable");

      expect(typeOrmRepository.update).toHaveBeenCalledWith("intent-1", {
        status: "launchable",
        terminal_outcome: null,
      });
    });
  });
});
