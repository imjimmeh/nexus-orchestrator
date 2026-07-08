import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  ExecutedDecisionIntent,
  ExecuteDirectMutationDecisionInput,
} from "./orchestration-decision-executor.types";
import { LANE_CAPACITY_CONFLICT_PREFIX } from "./control-plane.types";
import type {
  FreshFactRequirement,
  OrchestrationLane,
} from "./control-plane.types";
import {
  DEFAULT_LANE_CAPACITY,
  LANE_CAPACITY,
} from "./lane-capacity.constants";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";
import { OrchestrationLeaseService } from "./orchestration-lease.service";
import {
  structuredDecisionSchema,
  structuredDecisionToIntentInput,
  type StructuredOrchestrationDecision,
} from "./structured-decision.types";

@Injectable()
export class OrchestrationDecisionExecutorService {
  constructor(
    private readonly scheduler: OrchestrationControlPlaneSchedulerService,
    private readonly leaseService: OrchestrationLeaseService,
  ) {}

  async recordExecutableDecision(input: {
    readonly projectId: string;
    readonly requester: string;
    readonly structuredDecision: unknown;
    readonly terminalizeNoLaunch?: boolean;
  }): Promise<ExecutedDecisionIntent> {
    const parsed = structuredDecisionSchema.safeParse(input.structuredDecision);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const intent = await this.scheduler.createIntent(
      structuredDecisionToIntentInput(
        input.projectId,
        parsed.data,
        input.requester,
      ),
    );
    const requiredFacts = this.resolveRequiredFacts(parsed.data);
    const schedulerDecision = await this.scheduler.evaluateIntent(intent.id, {
      maxActivePerLane: this.resolveLaneCapacity(parsed.data.lane),
      requireFreshFactTypes: requiredFacts.map((r) => r.factType),
      requireFreshFacts: requiredFacts,
    });

    if (
      input.terminalizeNoLaunch &&
      schedulerDecision.status !== "launchable"
    ) {
      await this.scheduler.terminalizeIntent(
        intent.id,
        "blocked",
        schedulerDecision.reason,
        {
          message: `Direct mutation not launchable: ${schedulerDecision.reason}`,
          schedulerDecision,
        },
      );
      return {
        structuredDecision: parsed.data,
        intentId: intent.id,
        schedulerDecision: {
          ...schedulerDecision,
          status: "blocked",
        },
      };
    }

    return {
      structuredDecision: parsed.data,
      intentId: intent.id,
      schedulerDecision,
    };
  }

  async executeDirectMutationDecision<TResult>(
    input: ExecuteDirectMutationDecisionInput<TResult>,
  ): Promise<TResult> {
    const parsed = structuredDecisionSchema.safeParse(input.structuredDecision);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const intentInput = structuredDecisionToIntentInput(
      input.projectId,
      parsed.data,
      input.requester,
    );
    const ownerId = `${input.requester}:${intentInput.idempotencyKey ?? parsed.data.lane}`;

    const lease = await this.leaseService.acquireMutationLeases({
      projectId: input.projectId,
      lane: parsed.data.lane,
      ownerId,
      conflictKeys: intentInput.conflictKeys ?? [],
      laneCapacity: this.resolveLaneCapacity(parsed.data.lane),
    });

    if (!lease.acquired) {
      const laneCapacityConflicts = lease.conflicts.filter((c) =>
        c.conflictKey.value.startsWith(LANE_CAPACITY_CONFLICT_PREFIX),
      );
      if (laneCapacityConflicts.length > 0) {
        const holders = laneCapacityConflicts
          .map(
            (c) =>
              `${c.heldByOwnerKind}:${c.heldByOwnerId} (until ${c.expiresAt})`,
          )
          .join(", ");
        throw new BadRequestException(
          `lane_capacity_exhausted — lane "${parsed.data.lane}" is full, held by: ${holders}`,
        );
      }
      const keys = lease.conflicts
        .map((c) => `${c.conflictKey.kind}:${c.conflictKey.value}`)
        .join(", ");
      throw new BadRequestException(
        `Mutation blocked — conflicting lease(s) held: ${keys}`,
      );
    }

    try {
      return await input.execute({
        structuredDecision: parsed.data,
        intentId: "",
        schedulerDecision: {
          intentId: "",
          outcomeId: "",
          status: "launchable",
          reason: "no_conflicts",
          conflictKeys: intentInput.conflictKeys ?? [],
          activeConflicts: [],
          metadata: null,
        },
      });
    } finally {
      await this.leaseService.releaseOwned(input.projectId, ownerId);
    }
  }

  assertLaunchable(result: ExecutedDecisionIntent): void {
    if (result.schedulerDecision.status !== "launchable") {
      const reason = result.schedulerDecision.reason;
      const metadata = result.schedulerDecision.metadata;
      const missingTypes = metadata?.missingFreshFactTypes as
        | string[]
        | undefined;
      const detail = missingTypes?.length
        ? ` (missing fact types: ${missingTypes.join(", ")})`
        : "";
      throw new BadRequestException(
        `Decision is not launchable: ${reason}${detail}`,
      );
    }
  }

  private resolveLaneCapacity(lane: string): number {
    return LANE_CAPACITY[lane as OrchestrationLane] ?? DEFAULT_LANE_CAPACITY;
  }

  private resolveRequiredFacts(
    decision: StructuredOrchestrationDecision,
  ): FreshFactRequirement[] {
    if (decision.action === "dispatch_work_items") {
      return [
        {
          factType: "project_state_snapshot",
          subjectKind: "project",
          subjectIds: [],
        },
      ];
    }
    if (decision.action === "transition_work_item_status") {
      return decision.work_item_ids.map((id) => ({
        factType: "work_item_current_state",
        subjectKind: "work_item",
        subjectIds: [id],
      }));
    }
    return [];
  }
}
