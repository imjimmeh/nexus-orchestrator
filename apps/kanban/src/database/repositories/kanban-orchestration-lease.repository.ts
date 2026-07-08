import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager, LessThan, MoreThan } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { KanbanOrchestrationLeaseEntity } from "../entities/kanban-orchestration-lease.entity";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
  OrchestrationLane,
} from "../../orchestration/control-plane/control-plane.types";

const UNIQUE_VIOLATION = "23505";

@Injectable()
export class KanbanOrchestrationLeaseRepository {
  constructor(private readonly dataSource: DataSource) {}

  async acquire(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    // Canonical order avoids deadlocks between multi-key acquirers.
    const keys = [...input.conflictKeys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );

    return this.dataSource
      .transaction(async (manager) => {
        await this.reclaimExpired(manager, input.projectId, keys, now);

        const leaseIds: string[] = [];
        try {
          for (const key of keys) {
            const inserted = await manager.insert(
              KanbanOrchestrationLeaseEntity,
              {
                project_id: input.projectId,
                conflict_key_kind: key.kind,
                conflict_key_value: key.value,
                lane: input.lane,
                owner_kind: input.owner.kind,
                owner_id: input.owner.id,
                status: "active" as const,
                acquired_at: now,
                heartbeat_at: now,
                expires_at: expiresAt,
                released_at: null,
                metadata: input.metadata ?? null,
              } as unknown as QueryDeepPartialEntity<KanbanOrchestrationLeaseEntity>,
            );
            leaseIds.push(inserted.identifiers[0].id as string);
          }
        } catch (error) {
          if (this.isUniqueViolation(error)) {
            const conflicts = await this.loadConflicts(
              manager,
              input.projectId,
              keys,
            );
            throw new LeaseConflictRollback(conflicts);
          }
          throw error;
        }

        return { acquired: true as const, leaseIds };
      })
      .catch((error: unknown) => {
        if (error instanceof LeaseConflictRollback) {
          return { acquired: false as const, conflicts: error.conflicts };
        }
        throw error;
      });
  }

  async heartbeat(leaseId: string, ttlMs: number): Promise<void> {
    const now = new Date();
    await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { id: leaseId, status: "active" },
        { heartbeat_at: now, expires_at: new Date(now.getTime() + ttlMs) },
      );
  }

  async release(leaseId: string, ownerId: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { id: leaseId, owner_id: ownerId, status: "active" },
        { status: "released", released_at: new Date() },
      );
    return (result.affected ?? 0) > 0;
  }

  async expireOverdue(now: Date): Promise<KanbanOrchestrationLeaseEntity[]> {
    const repo = this.dataSource.getRepository(KanbanOrchestrationLeaseEntity);
    const overdue = await repo.find({
      where: { status: "active", expires_at: LessThan(now) },
    });
    if (overdue.length === 0) return [];
    await repo.update(
      { status: "active", expires_at: LessThan(now) },
      { status: "expired" },
    );
    return overdue;
  }

  listActiveByProject(
    projectId: string,
  ): Promise<KanbanOrchestrationLeaseEntity[]> {
    return this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .find({ where: { project_id: projectId, status: "active" } });
  }

  countActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<number> {
    return this.dataSource.getRepository(KanbanOrchestrationLeaseEntity).count({
      where: {
        project_id: projectId,
        lane,
        status: "active",
        expires_at: MoreThan(new Date()),
      },
    });
  }

  listActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<KanbanOrchestrationLeaseEntity[]> {
    return this.dataSource.getRepository(KanbanOrchestrationLeaseEntity).find({
      where: {
        project_id: projectId,
        lane,
        status: "active",
        expires_at: MoreThan(new Date()),
      },
    });
  }

  async releaseAllForProject(projectId: string): Promise<number> {
    const result = await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { project_id: projectId, status: "active" },
        { status: "released", released_at: new Date() },
      );
    return result.affected ?? 0;
  }

  private async reclaimExpired(
    manager: EntityManager,
    projectId: string,
    keys: OrchestrationConflictKey[],
    now: Date,
  ): Promise<void> {
    for (const key of keys) {
      await manager.query(
        `UPDATE kanban_orchestration_leases
         SET status = 'expired'
         WHERE project_id = $1 AND conflict_key_kind = $2
           AND conflict_key_value = $3 AND status = 'active' AND expires_at < $4`,
        [projectId, key.kind, key.value, now],
      );
    }
  }

  private async loadConflicts(
    manager: EntityManager,
    projectId: string,
    keys: OrchestrationConflictKey[],
  ): Promise<LeaseConflict[]> {
    const conflicts: LeaseConflict[] = [];
    for (const key of keys) {
      const rows: Array<{
        conflict_key_kind: OrchestrationConflictKey["kind"];
        conflict_key_value: string;
        owner_kind: LeaseConflict["heldByOwnerKind"];
        owner_id: string;
        expires_at: Date;
      }> = await manager.query(
        `SELECT conflict_key_kind, conflict_key_value, owner_kind, owner_id, expires_at
         FROM kanban_orchestration_leases
         WHERE project_id = $1 AND conflict_key_kind = $2
           AND conflict_key_value = $3 AND status = 'active'`,
        [projectId, key.kind, key.value],
      );
      for (const row of rows) {
        conflicts.push({
          conflictKey: {
            kind: row.conflict_key_kind,
            value: row.conflict_key_value,
          },
          heldByOwnerKind: row.owner_kind,
          heldByOwnerId: row.owner_id,
          expiresAt: new Date(row.expires_at).toISOString(),
        });
      }
    }
    return conflicts;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    );
  }
}

class LeaseConflictRollback extends Error {
  constructor(public readonly conflicts: LeaseConflict[]) {
    super("lease_conflict");
  }
}
