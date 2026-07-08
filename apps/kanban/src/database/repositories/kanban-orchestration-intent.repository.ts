import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { KanbanOrchestrationIntentEntity } from "../entities/kanban-orchestration-intent.entity";
import type {
  CreateOrchestrationIntentInput,
  OrchestrationIntentStatus,
  OrchestrationLane,
} from "../../orchestration/control-plane/control-plane.types";

const ACTIVE_INTENT_STATUSES: OrchestrationIntentStatus[] = [
  "pending",
  "launchable",
  "running",
];

@Injectable()
export class KanbanOrchestrationIntentRepository {
  constructor(
    @InjectRepository(KanbanOrchestrationIntentEntity)
    private readonly repository: Repository<KanbanOrchestrationIntentEntity>,
  ) {}

  async createIntent(
    input: CreateOrchestrationIntentInput,
  ): Promise<KanbanOrchestrationIntentEntity> {
    const idempotencyKey = this.resolveIdempotencyKey(input);
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing && !this.isTerminal(existing.status)) return existing;

    const finalKey = existing
      ? `${idempotencyKey}:${Date.now()}`
      : idempotencyKey;
    return this.saveNewIntent(input, finalKey);
  }

  private isTerminal(status: OrchestrationIntentStatus): boolean {
    return [
      "completed",
      "blocked",
      "suppressed",
      "failed",
      "cancelled",
      "superseded",
    ].includes(status);
  }

  findById(id: string): Promise<KanbanOrchestrationIntentEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<KanbanOrchestrationIntentEntity | null> {
    return this.repository.findOne({
      where: { idempotency_key: idempotencyKey },
    });
  }

  listByProject(
    projectId: string,
    statuses?: OrchestrationIntentStatus[],
  ): Promise<KanbanOrchestrationIntentEntity[]> {
    return this.repository.find({
      where: {
        project_id: projectId,
        ...(statuses && statuses.length > 0 ? { status: In(statuses) } : {}),
      },
      order: { priority: "DESC", created_at: "ASC" },
    });
  }

  listActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<KanbanOrchestrationIntentEntity[]> {
    return this.repository.find({
      where: {
        project_id: projectId,
        lane,
        status: In(ACTIVE_INTENT_STATUSES),
      },
      order: { priority: "DESC", created_at: "ASC" },
    });
  }

  async updateStatus(
    id: string,
    status: OrchestrationIntentStatus,
    terminalOutcome?: string | null,
  ): Promise<void> {
    await this.repository.update(id, {
      status,
      terminal_outcome: terminalOutcome ?? null,
    });
  }

  private async saveNewIntent(
    input: CreateOrchestrationIntentInput,
    idempotencyKey: string,
  ): Promise<KanbanOrchestrationIntentEntity> {
    try {
      return await this.repository.save(
        this.repository.create({
          project_id: input.projectId,
          lane: input.lane,
          type: input.type,
          status: "pending",
          requester: input.requester,
          reason: input.reason,
          priority: input.priority ?? 0,
          evidence: input.evidence ?? [],
          resource_refs: input.resources ?? [],
          conflict_keys: input.conflictKeys ?? [],
          workflow_id: input.workflow?.workflowId ?? null,
          workflow_scope: input.workflow?.scope ?? null,
          idempotency_key: idempotencyKey,
          supersedes_intent_id: input.supersedesIntentId ?? null,
          freshness_requirements: input.freshnessRequirements ?? {},
          terminal_outcome: null,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (error) {
      return this.handleCreateIntentError(error, idempotencyKey);
    }
  }

  private async handleCreateIntentError(
    error: unknown,
    idempotencyKey: string,
  ): Promise<KanbanOrchestrationIntentEntity> {
    if (this.isUniqueViolation(error)) {
      const existingAfterRace = await this.findByIdempotencyKey(idempotencyKey);
      if (existingAfterRace && !this.isTerminal(existingAfterRace.status)) {
        return existingAfterRace;
      }
    }
    throw error;
  }

  private resolveIdempotencyKey(input: CreateOrchestrationIntentInput): string {
    return input.idempotencyKey ?? this.buildIdempotencyKey(input);
  }

  private buildIdempotencyKey(input: CreateOrchestrationIntentInput): string {
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.projectId,
          input.lane,
          input.type,
          input.requester,
          input.reason,
        ]),
      )
      .digest("hex");
    return `orchestration-intent:${hash}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    );
  }
}
