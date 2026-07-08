import { Injectable } from "@nestjs/common";
import { KanbanOrchestrationLeaseRepository } from "../../database/repositories/kanban-orchestration-lease.repository";
import { LANE_CAPACITY_CONFLICT_PREFIX } from "./control-plane.types";
import type {
  AcquireLeaseResult,
  OrchestrationConflictKey,
  OrchestrationLane,
} from "./control-plane.types";

export const CYCLE_LEASE_TTL_MS = 10 * 60 * 1000;

function cycleConflictKey(projectId: string): OrchestrationConflictKey {
  return {
    kind: "workflow_scope",
    value: `project_orchestration_cycle_ceo:${projectId}`,
  };
}

@Injectable()
export class OrchestrationLeaseService {
  constructor(private readonly leases: KanbanOrchestrationLeaseRepository) {}

  acquireCycleLease(
    projectId: string,
    correlationId: string,
  ): Promise<AcquireLeaseResult> {
    return this.leases.acquire({
      projectId,
      lane: "strategy",
      owner: { kind: "cycle_request", id: correlationId },
      conflictKeys: [cycleConflictKey(projectId)],
      ttlMs: CYCLE_LEASE_TTL_MS,
    });
  }

  async heartbeatCycleLease(projectId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    const cycle = active.find(
      (lease) =>
        lease.conflict_key_kind === "workflow_scope" &&
        lease.conflict_key_value ===
          `project_orchestration_cycle_ceo:${projectId}`,
    );
    if (cycle) {
      await this.leases.heartbeat(cycle.id, CYCLE_LEASE_TTL_MS);
    }
  }

  async releaseCycleLease(projectId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    for (const lease of active) {
      if (
        lease.conflict_key_kind === "workflow_scope" &&
        lease.conflict_key_value ===
          `project_orchestration_cycle_ceo:${projectId}`
      ) {
        await this.leases.release(lease.id, lease.owner_id);
      }
    }
  }

  hasActiveCycleLease(projectId: string): Promise<boolean> {
    return this.leases
      .listActiveByProject(projectId)
      .then((active) =>
        active.some(
          (lease) =>
            lease.conflict_key_kind === "workflow_scope" &&
            lease.conflict_key_value ===
              `project_orchestration_cycle_ceo:${projectId}`,
        ),
      );
  }

  async acquireMutationLeases(input: {
    projectId: string;
    lane: OrchestrationLane;
    ownerId: string;
    conflictKeys: OrchestrationConflictKey[];
    laneCapacity: number;
    ttlMs?: number;
  }): Promise<AcquireLeaseResult> {
    const active = await this.leases.countActiveByLane(
      input.projectId,
      input.lane,
    );
    if (active >= input.laneCapacity) {
      const holders = await this.leases.listActiveByLane(
        input.projectId,
        input.lane,
      );
      // Guard against the TOCTOU race where the holder expired/released between
      // countActiveByLane and listActiveByLane: if there are no real active
      // holders, the lane has actually freed — fall through and acquire normally.
      if (holders.length > 0) {
        return {
          acquired: false,
          conflicts: holders.map((held) => ({
            conflictKey: {
              kind: "workflow_scope" as const,
              value: `${LANE_CAPACITY_CONFLICT_PREFIX}${input.lane}`,
            },
            heldByOwnerKind: held.owner_kind,
            heldByOwnerId: held.owner_id,
            expiresAt: new Date(held.expires_at).toISOString(),
          })),
        };
      }
    }
    return this.leases.acquire({
      projectId: input.projectId,
      lane: input.lane,
      owner: { kind: "direct_mutation", id: input.ownerId },
      conflictKeys: input.conflictKeys,
      ttlMs: input.ttlMs ?? CYCLE_LEASE_TTL_MS,
    });
  }

  async releaseOwned(projectId: string, ownerId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    for (const lease of active) {
      if (lease.owner_id === ownerId) {
        await this.leases.release(lease.id, ownerId);
      }
    }
  }

  releaseAllForProject(projectId: string): Promise<number> {
    return this.leases.releaseAllForProject(projectId);
  }
}
