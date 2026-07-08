import { Injectable, NotFoundException } from "@nestjs/common";
import { KanbanOrchestrationFactEntity } from "../../database/entities/kanban-orchestration-fact.entity";
import { KanbanOrchestrationIntentEntity } from "../../database/entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationLaunchAttemptEntity } from "../../database/entities/kanban-orchestration-launch-attempt.entity";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "../../database/entities/kanban-orchestration-scheduler-outcome.entity";
import { KanbanOrchestrationFactRepository } from "../../database/repositories/kanban-orchestration-fact.repository";
import { KanbanOrchestrationIntentRepository } from "../../database/repositories/kanban-orchestration-intent.repository";
import { KanbanOrchestrationLaunchAttemptRepository } from "../../database/repositories/kanban-orchestration-launch-attempt.repository";
import { KanbanOrchestrationSchedulerOutcomeRepository } from "../../database/repositories/kanban-orchestration-scheduler-outcome.repository";
import type {
  CreateOrchestrationIntentInput,
  FreshFactRequirement,
  OrchestrationConflictKey,
  OrchestrationIntentStatus,
  PublishOrchestrationFactInput,
  RecordLaunchAttemptInput,
  SchedulerDecision,
  SchedulerOutcomeReason,
  SchedulerOutcomeStatus,
  SchedulerPolicyInput,
} from "./control-plane.types";

type RecordIntentLaunchAttemptInput = Omit<
  RecordLaunchAttemptInput,
  "projectId"
>;

@Injectable()
export class OrchestrationControlPlaneSchedulerService {
  constructor(
    private readonly intents: KanbanOrchestrationIntentRepository,
    private readonly facts: KanbanOrchestrationFactRepository,
    private readonly outcomes: KanbanOrchestrationSchedulerOutcomeRepository,
    private readonly launchAttempts: KanbanOrchestrationLaunchAttemptRepository,
  ) {}

  createIntent(
    input: CreateOrchestrationIntentInput,
  ): Promise<KanbanOrchestrationIntentEntity> {
    return this.intents.createIntent(input);
  }

  publishFact(
    input: PublishOrchestrationFactInput,
  ): Promise<KanbanOrchestrationFactEntity> {
    return this.facts.publishFact(input);
  }

  async evaluateIntent(
    intentId: string,
    policy: SchedulerPolicyInput = {},
  ): Promise<SchedulerDecision> {
    const intent = await this.requireIntent(intentId);
    const now = policy.now ?? new Date();

    const laneCapacityReached = await this.isLaneCapacityReached(
      intent,
      policy,
    );
    if (laneCapacityReached) {
      return this.recordDecision(intent, {
        status: "deferred",
        reason: "lane_capacity_reached",
        activeConflicts: [],
        now,
        policy,
      });
    }

    const missingFacts = await this.findMissingFreshFacts(
      intent.project_id,
      this.resolveFreshFactRequirements(policy),
      now,
    );
    if (missingFacts.length > 0) {
      const missingFactTypes = missingFacts.map((r) => r.factType);
      return this.recordDecision(intent, {
        status: "deferred",
        reason: "missing_fresh_fact",
        activeConflicts: [],
        now,
        policy,
        metadata: {
          missingFreshFactTypes: missingFactTypes,
          missingFreshFacts: missingFacts,
        },
      });
    }

    return this.recordDecision(intent, {
      status: "launchable",
      reason: "no_conflicts",
      activeConflicts: [],
      now,
      policy,
    });
  }

  async recordLaunchAttempt(
    input: RecordIntentLaunchAttemptInput,
  ): Promise<KanbanOrchestrationLaunchAttemptEntity> {
    const intent = await this.requireIntent(input.intentId);
    return this.launchAttempts.recordAttempt({
      ...input,
      projectId: intent.project_id,
    });
  }

  async terminalizeIntent(
    intentId: string,
    terminalOutcome: "blocked" | "suppressed" | "failed",
    reason: SchedulerOutcomeReason,
    metadata?: Record<string, unknown>,
  ): Promise<SchedulerDecision> {
    const intent = await this.requireIntent(intentId);
    return this.recordDecision(intent, {
      status: terminalOutcome,
      reason,
      activeConflicts: [],
      now: new Date(),
      policy: {},
      metadata,
    });
  }

  async markIntentRunning(
    intentId: string,
    reason: Extract<SchedulerOutcomeReason, "direct_mutation_started">,
    metadata?: Record<string, unknown>,
  ): Promise<SchedulerDecision> {
    const intent = await this.requireIntent(intentId);
    await this.intents.updateStatus(intent.id, "running");
    return {
      intentId: intent.id,
      outcomeId: "",
      status: "launchable",
      reason,
      conflictKeys: intent.conflict_keys,
      activeConflicts: [],
      metadata: metadata ?? null,
    };
  }

  async completeIntent(
    intentId: string,
    reason: Extract<
      SchedulerOutcomeReason,
      "workflow_launched" | "direct_mutation_completed"
    >,
    metadata?: Record<string, unknown>,
  ): Promise<SchedulerDecision> {
    const intent = await this.requireIntent(intentId);
    return this.recordDecision(intent, {
      status: "completed",
      reason,
      activeConflicts: [],
      now: new Date(),
      policy: {},
      metadata,
    });
  }

  listIntentOutcomes(
    intentId: string,
  ): Promise<KanbanOrchestrationSchedulerOutcomeEntity[]> {
    return this.outcomes.listByIntent(intentId);
  }

  private async requireIntent(
    intentId: string,
  ): Promise<KanbanOrchestrationIntentEntity> {
    const intent = await this.intents.findById(intentId);
    if (!intent) {
      throw new NotFoundException(`Orchestration intent ${intentId} not found`);
    }
    return intent;
  }

  private async isLaneCapacityReached(
    intent: KanbanOrchestrationIntentEntity,
    policy: SchedulerPolicyInput,
  ): Promise<boolean> {
    if (policy.maxActivePerLane === undefined) return false;

    const activeLaneIntents = await this.intents.listActiveByLane(
      intent.project_id,
      intent.lane,
    );
    const otherActiveIntents = activeLaneIntents.filter(
      (activeIntent) => activeIntent.id !== intent.id,
    );

    return otherActiveIntents.length >= policy.maxActivePerLane;
  }

  private resolveFreshFactRequirements(
    policy: SchedulerPolicyInput,
  ): FreshFactRequirement[] {
    if (policy.requireFreshFacts && policy.requireFreshFacts.length > 0) {
      return policy.requireFreshFacts;
    }
    // Legacy support: convert flat string list to project-level requirements
    if (
      policy.requireFreshFactTypes &&
      policy.requireFreshFactTypes.length > 0
    ) {
      return policy.requireFreshFactTypes.map((factType) => ({
        factType,
        subjectKind: "project",
        subjectIds: [],
      }));
    }
    return [];
  }

  private async findMissingFreshFacts(
    projectId: string,
    requirements: FreshFactRequirement[],
    now: Date,
  ): Promise<FreshFactRequirement[]> {
    if (requirements.length === 0) return [];

    const freshFacts = await this.facts.listFreshByTypesAndSubjects(
      projectId,
      requirements,
      now,
    );

    return requirements.filter((req) => {
      if (req.subjectIds.length === 0) {
        // Project-level: satisfied if any matching fact exists
        return !freshFacts.some((f) => f.fact_type === req.factType);
      }
      // Subject-level: each subject must have a matching fact
      const matchedSubjects = new Set(
        freshFacts
          .filter(
            (f) =>
              f.fact_type === req.factType &&
              f.subject_kind === req.subjectKind,
          )
          .map((f) => f.subject_id),
      );
      return !req.subjectIds.every((id) => matchedSubjects.has(id));
    });
  }

  private async recordDecision(
    intent: KanbanOrchestrationIntentEntity,
    input: {
      readonly status: SchedulerOutcomeStatus;
      readonly reason: SchedulerOutcomeReason;
      readonly activeConflicts: OrchestrationConflictKey[];
      readonly now: Date;
      readonly policy: SchedulerPolicyInput;
      readonly metadata?: Record<string, unknown>;
    },
  ): Promise<SchedulerDecision> {
    const outcome = await this.outcomes.recordOutcome({
      intentId: intent.id,
      projectId: intent.project_id,
      status: input.status,
      reason: input.reason,
      conflictKeys: intent.conflict_keys,
      activeConflicts: input.activeConflicts,
      evaluatedAt: input.now,
      policySnapshot: {
        maxActivePerLane: input.policy.maxActivePerLane ?? null,
        requireFreshFactTypes: input.policy.requireFreshFactTypes ?? [],
        metadata: input.policy.metadata ?? null,
      },
      metadata: input.metadata ?? null,
    });

    await this.intents.updateStatus(
      intent.id,
      this.toIntentStatus(input.status),
    );

    return {
      intentId: intent.id,
      outcomeId: outcome.id,
      status: input.status,
      reason: input.reason,
      conflictKeys: intent.conflict_keys,
      activeConflicts: input.activeConflicts,
      metadata: input.metadata ?? null,
    };
  }

  private toIntentStatus(
    status: SchedulerOutcomeStatus,
  ): OrchestrationIntentStatus {
    if (status === "deferred") {
      return "pending";
    }
    return status;
  }
}
