import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PermissionRow {
  name: string;
}

@Injectable({ scope: Scope.REQUEST })
export class AuthorizationService {
  private readonly cache = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(RoleAssignment)
    private readonly assignments: Repository<RoleAssignment>,
  ) {}

  async getEffectivePermissions(
    userId: string,
    scopeNodeId: string = GLOBAL_SCOPE_NODE_ID,
    roles?: string[],
  ): Promise<Set<string>> {
    // Agent tokens (e.g. "agent:<runId>:<jobId>") are not UUID user identities
    // and have no rows in role_assignments. Querying with a non-UUID value causes
    // a Postgres 22P02 error because user_id is a uuid column.
    if (!UUID_PATTERN.test(userId)) {
      if (!roles || roles.length === 0) {
        return new Set<string>();
      }

      const key = `${userId}|${scopeNodeId}|${[...roles].sort().join(',')}`;
      const cached = this.cache.get(key);
      if (cached) return cached;

      const normalizedRoleNames = roles.map((r) => r.toLowerCase());
      const rows = await this.assignments.query<PermissionRow[]>(
        `SELECT DISTINCT p.name
           FROM roles r
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE LOWER(r.name) = ANY($1)`,
        [normalizedRoleNames],
      );

      const perms = new Set<string>(rows.map((r) => r.name));
      this.cache.set(key, perms);
      return perms;
    }

    const key = `${userId}|${scopeNodeId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const rows = await this.assignments.query<PermissionRow[]>(
      `SELECT DISTINCT p.name
         FROM role_assignments ra
         JOIN scope_node_closure c
           ON c.ancestor_id = ra.scope_node_id
          AND c.descendant_id = $2
         JOIN role_permissions rp ON rp.role_id = ra.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ra.user_id = $1`,
      [userId, scopeNodeId],
    );

    const perms = new Set<string>(rows.map((r) => r.name));
    this.cache.set(key, perms);
    return perms;
  }

  async can(
    userId: string,
    permissionName: string,
    scopeNodeId: string = GLOBAL_SCOPE_NODE_ID,
    roles?: string[],
  ): Promise<boolean> {
    const perms = await this.getEffectivePermissions(
      userId,
      scopeNodeId,
      roles,
    );
    if (perms.has(permissionName)) return true;
    const [resource] = permissionName.split(':');
    return perms.has(`${resource}:manage`);
  }
}
