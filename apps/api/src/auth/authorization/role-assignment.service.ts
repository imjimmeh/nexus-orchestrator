import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { EffectiveMember } from '@nexus/core';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { AuthorizationAuditService } from './authorization-audit.service';

interface EffectiveMemberRow {
  user_id: string;
  user_email: string;
  role_id: string;
  role_name: string;
  source_scope_node_id: string;
  source_scope_name: string;
  depth: number;
}

@Injectable()
export class RoleAssignmentService {
  constructor(
    @InjectRepository(RoleAssignment)
    private readonly assignments: Repository<RoleAssignment>,
    @Optional() private readonly authzAudit?: AuthorizationAuditService,
  ) {}

  /**
   * Idempotent: returns the existing grant if it already exists.
   *
   * When `manager` is supplied, the read and write run through that
   * transaction's `EntityManager` so the grant commits or rolls back atomically
   * with the caller's other writes (e.g. invitation acceptance). When omitted,
   * behaves exactly as before against the injected repository.
   */
  async assignRole(
    userId: string,
    roleId: string,
    scopeNodeId: string,
    actorId?: string,
    manager?: EntityManager,
  ): Promise<RoleAssignment> {
    const repository = manager
      ? manager.getRepository(RoleAssignment)
      : this.assignments;
    const existing = await repository.findOne({
      where: { userId, roleId, scopeNodeId },
    });
    if (existing) return existing;
    const result = await repository.save(
      repository.create({ userId, roleId, scopeNodeId }),
    );
    await this.authzAudit?.recordRoleGranted({
      actorId: actorId ?? 'system',
      userId,
      roleId,
      scopeNodeId,
    });
    return result;
  }

  async revokeRole(
    userId: string,
    roleId: string,
    scopeNodeId: string,
    actorId?: string,
  ): Promise<void> {
    await this.assignments.delete({ userId, roleId, scopeNodeId });
    await this.authzAudit?.recordRoleRevoked({
      actorId: actorId ?? 'system',
      userId,
      roleId,
      scopeNodeId,
    });
  }

  listAssignmentsForUser(userId: string): Promise<RoleAssignment[]> {
    return this.assignments.find({ where: { userId } });
  }

  listAssignmentsAtNode(scopeNodeId: string): Promise<RoleAssignment[]> {
    return this.assignments.find({ where: { scopeNodeId } });
  }

  /**
   * Effective members at a scope node: DIRECT assignments at the node itself
   * (closure depth 0) plus INHERITED assignments from ancestor nodes, walked
   * via `scope_node_closure`. Mirrors `AuthorizationService.getEffectivePermissions`.
   */
  async listEffectiveMembersAtNode(
    scopeNodeId: string,
  ): Promise<EffectiveMember[]> {
    const rows = await this.assignments.query<EffectiveMemberRow[]>(
      `SELECT ra.user_id,
              u.email AS user_email,
              ra.role_id,
              r.name AS role_name,
              ra.scope_node_id AS source_scope_node_id,
              sn.name AS source_scope_name,
              c.depth AS depth
         FROM role_assignments ra
         JOIN scope_node_closure c
           ON c.ancestor_id = ra.scope_node_id
          AND c.descendant_id = $1
         JOIN users u ON u.id = ra.user_id
         JOIN roles r ON r.id = ra.role_id
         JOIN scope_nodes sn ON sn.id = ra.scope_node_id
        ORDER BY c.depth ASC, u.email ASC`,
      [scopeNodeId],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      userEmail: row.user_email,
      roleId: row.role_id,
      roleName: row.role_name,
      source: row.depth === 0 ? 'direct' : 'inherited',
      sourceScopeNodeId: row.source_scope_node_id,
      sourceScopeName: row.source_scope_name,
    }));
  }
}
