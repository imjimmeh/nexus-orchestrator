import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GITOPS_MANAGED_BY } from '../gitops.constants';
import { ScopeService } from '../../scope/scope.service';
import type {
  GitOpsApplyContext,
  GitOpsEditPolicyContext,
  GitOpsEditPolicyResult,
  GitOpsNormalizedObject,
  GitOpsObjectHandler,
  GitOpsObjectPlan,
  GitOpsPlanInput,
  GitOpsSerializedObject,
} from './gitops-object-handler.types';
import type { EntityManager } from 'typeorm';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  owner_scope_node_id: string | null;
  managed_by: string | null;
  locked: boolean;
}

interface ScopeTreeNodeLike {
  id: string;
  slug: string;
  children: ScopeTreeNodeLike[];
}

interface RoleDesiredInput {
  key: string;
  objectType: 'role';
  fields: {
    description?: string;
    ownerScope?: string | null;
    permissions?: string[];
  };
}

@Injectable()
export class RoleGitopsHandler implements GitOpsObjectHandler<RoleDesiredInput> {
  readonly objectType = 'role' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async readActual(_scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const roles: RoleRow[] = await this.dataSource.query(
      `SELECT id, name, description, owner_scope_node_id, managed_by, locked FROM roles`,
    );

    const permissionsByRole = await this.loadPermissionsByRole();
    const scopePathById = await this.loadScopePathById();

    return roles.map((role) =>
      this.serialize(
        this.toActual(
          role,
          permissionsByRole.get(role.id) ?? [],
          scopePathById,
        ),
      ),
    );
  }

  normalizeDesired(input: RoleDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<RoleDesiredInput>,
  ): GitOpsObjectPlan<RoleDesiredInput> {
    if (!change.actual) {
      return {
        objectType: this.objectType,
        key: change.desired?.key ?? '',
        op: 'create',
        desired: change.desired,
        actual: null,
      };
    }

    if (!change.desired) {
      return {
        objectType: this.objectType,
        key: change.actual.key,
        op: 'delete',
        desired: null,
        actual: change.actual,
      };
    }

    const diff = this.diffFields(change.actual.fields, change.desired.fields);
    return {
      objectType: this.objectType,
      key: change.desired.key,
      op: Object.keys(diff).length === 0 ? 'noop' : 'update',
      desired: change.desired,
      actual: change.actual,
      diff,
    };
  }

  async apply(
    change: GitOpsObjectPlan<RoleDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    if (change.op === 'noop') {
      return;
    }

    if (change.op === 'create' && change.desired) {
      const ownerScopeNodeId = await this.resolveOwnerScopeNodeId(
        change.desired.fields.ownerScope ?? null,
      );
      await context.manager.query(
        `INSERT INTO roles (name, description, owner_scope_node_id, managed_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [
          change.desired.key,
          change.desired.fields.description ?? '',
          ownerScopeNodeId,
          GITOPS_MANAGED_BY,
        ],
      );
      await this.syncPermissions(
        context.manager,
        change.desired.key,
        change.desired.fields.permissions ?? [],
      );
      return;
    }

    if (change.op === 'delete') {
      await context.manager.query(
        `DELETE FROM roles WHERE name = $1 AND managed_by = $2`,
        [change.key, GITOPS_MANAGED_BY],
      );
      return;
    }

    if (change.op === 'update' && change.desired) {
      await this.updateRole(context.manager, change);
      if (Object.hasOwn(change.desired.fields, 'permissions')) {
        await this.syncPermissions(
          context.manager,
          change.key,
          change.desired.fields.permissions ?? [],
        );
      }
    }
  }

  serialize(actual: GitOpsSerializedObject): GitOpsSerializedObject {
    return {
      objectType: this.objectType,
      key: actual.key,
      fields: { ...actual.fields },
      managedBy: actual.managedBy,
      locked: actual.locked,
    };
  }

  canEdit(context: GitOpsEditPolicyContext): GitOpsEditPolicyResult {
    if (context.locked) {
      return { allowed: false, reason: 'object is locked' };
    }

    if (context.managedBy !== GITOPS_MANAGED_BY) {
      return { allowed: false, reason: 'object is not gitops-managed' };
    }

    return { allowed: true };
  }

  private toActual(
    row: RoleRow,
    permissions: string[],
    scopePathById: Map<string, string>,
  ): GitOpsSerializedObject {
    return {
      objectType: this.objectType,
      key: row.name,
      fields: {
        description: row.description,
        ownerScope: row.owner_scope_node_id
          ? (scopePathById.get(row.owner_scope_node_id) ??
            `/${row.owner_scope_node_id}`)
          : null,
        permissions,
      },
      managedBy: row.managed_by,
      locked: row.locked,
    };
  }

  private diffFields(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(to)) {
      if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
        diff[key] = { from: from[key], to: to[key] };
      }
    }
    return diff;
  }

  private async resolveOwnerScopeNodeId(
    scopePath: string | null,
  ): Promise<string | null> {
    if (!scopePath) {
      return null;
    }

    if (scopePath === '/') {
      return (await this.scope.getTree())?.id ?? null;
    }

    const tree = (await this.scope.getTree()) as ScopeTreeNodeLike | null;
    if (!tree) {
      return null;
    }

    const segments = scopePath
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean);
    let current: ScopeTreeNodeLike | null = tree;

    for (const segment of segments) {
      current =
        (current?.children ?? []).find((child) => child.slug === segment) ??
        null;
      if (!current) {
        return null;
      }
    }

    return current.id;
  }

  private async loadPermissionsByRole(): Promise<Map<string, string[]>> {
    const rows: Array<{ role_id: string; name: string }> =
      await this.dataSource.query(
        `SELECT rp.role_id, p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`,
      );
    const permissionsByRole = new Map<string, string[]>();
    for (const row of rows) {
      const current = permissionsByRole.get(row.role_id) ?? [];
      current.push(row.name);
      permissionsByRole.set(row.role_id, current);
    }
    return permissionsByRole;
  }

  private async loadScopePathById(): Promise<Map<string, string>> {
    const tree = (await this.scope.getTree()) as ScopeTreeNodeLike | null;
    const paths = new Map<string, string>();
    if (!tree) {
      return paths;
    }

    const visit = (node: ScopeTreeNodeLike, parentPath: string): void => {
      const path =
        parentPath === '/' ? `/${node.slug}` : `${parentPath}/${node.slug}`;
      const normalizedPath = node.slug === '' ? '/' : path;
      paths.set(node.id, normalizedPath);
      for (const child of node.children ?? []) {
        visit(child, normalizedPath);
      }
    };

    visit(tree, '/');
    return paths;
  }

  private async syncPermissions(
    manager: EntityManager,
    roleName: string,
    permissions: string[],
  ): Promise<void> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM roles WHERE name = $1`,
      [roleName],
    );
    const roleId = rows[0]?.id;
    if (!roleId) {
      return;
    }

    await manager.query(`DELETE FROM role_permissions WHERE role_id = $1`, [
      roleId,
    ]);
    if (permissions.length === 0) {
      return;
    }

    await manager.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id
       FROM permissions p
       WHERE p.name = ANY($2)
       ON CONFLICT DO NOTHING`,
      [roleId, permissions],
    );
  }

  private async updateRole(
    manager: EntityManager,
    change: GitOpsObjectPlan<RoleDesiredInput>,
  ): Promise<void> {
    if (!change.desired) {
      return;
    }

    const updates: Array<[string, unknown]> = [];
    if (Object.hasOwn(change.desired.fields, 'description')) {
      updates.push(['description', change.desired.fields.description ?? '']);
    }
    if (Object.hasOwn(change.desired.fields, 'ownerScope')) {
      updates.push([
        'owner_scope_node_id',
        await this.resolveOwnerScopeNodeId(
          change.desired.fields.ownerScope ?? null,
        ),
      ]);
    }

    if (updates.length === 0) {
      return;
    }

    const assignments = updates
      .map(([column], index) => `${column} = $${index + 2}`)
      .join(', ');
    const managedByParam = updates.length + 2;
    await manager.query(
      `UPDATE roles SET ${assignments} WHERE name = $1 AND managed_by = $${managedByParam}`,
      [change.key, ...updates.map(([, value]) => value), GITOPS_MANAGED_BY],
    );
  }
}
