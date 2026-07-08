import { Injectable } from '@nestjs/common';
import { GITOPS_MANAGED_BY } from '../gitops.constants';
import { DataSource } from 'typeorm';
import { ScopeService } from '../../scope/scope.service';
import { RoleRepository } from '../../auth/database/repositories/role.repository';
import { UserRepository } from '../../users/database/repositories/user.repository';
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

interface RoleAssignmentRow {
  user_id: string;
  username: string;
  role_id: string;
  role_name: string;
  scope_node_id: string;
  managed_by: string | null;
  locked: boolean;
}

interface RoleAssignmentDesiredInput {
  key: string;
  objectType: 'role_assignment';
  fields: {
    userId?: string;
    roleId?: string;
    scopeNodeId?: string;
    user?: string;
    role?: string;
    scope?: string;
  };
}

interface ScopeTreeNodeLike {
  id: string;
  slug: string;
  children: ScopeTreeNodeLike[];
}

@Injectable()
export class RoleAssignmentGitopsHandler implements GitOpsObjectHandler<RoleAssignmentDesiredInput> {
  readonly objectType = 'role_assignment' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly scope: ScopeService,
  ) {}

  async readActual(scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const descendants = await this.scope.getDescendantIds(scopeNodeId);
    if (descendants.length === 0) {
      return [];
    }

    const rows: RoleAssignmentRow[] = await this.dataSource.query(
      `SELECT ra.user_id, u.username, ra.role_id, r.name AS role_name, ra.scope_node_id, ra.managed_by, ra.locked
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id
       JOIN roles r ON r.id = ra.role_id
       WHERE ra.scope_node_id = ANY($1)`,
      [descendants],
    );

    const scopePathById = await this.loadScopePathById();

    return rows.map((row) => this.serialize(this.toActual(row, scopePathById)));
  }

  normalizeDesired(input: RoleAssignmentDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<RoleAssignmentDesiredInput>,
  ): GitOpsObjectPlan<RoleAssignmentDesiredInput> {
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
    change: GitOpsObjectPlan<RoleAssignmentDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    if (change.op === 'noop') {
      return;
    }

    if (change.op === 'create' && change.desired) {
      const resolved = await this.resolveDesiredIdentifiers(
        change.desired.fields,
      );
      await context.manager.query(
        `INSERT INTO role_assignments (user_id, role_id, scope_node_id, managed_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, role_id, scope_node_id) DO NOTHING`,
        [
          resolved.userId,
          resolved.roleId,
          resolved.scopeNodeId,
          GITOPS_MANAGED_BY,
        ],
      );
      return;
    }

    if (change.op === 'delete') {
      const actual = change.actual;
      if (!actual) {
        return;
      }
      const resolved = await this.resolveDesiredIdentifiers(actual.fields);

      await context.manager.query(
        `DELETE FROM role_assignments
         WHERE user_id = $1 AND role_id = $2 AND scope_node_id = $3 AND managed_by = $4`,
        [
          resolved.userId,
          resolved.roleId,
          resolved.scopeNodeId,
          GITOPS_MANAGED_BY,
        ],
      );
      return;
    }

    if (change.op === 'update' && change.desired && change.actual) {
      const resolved = await this.resolveDesiredIdentifiers(
        change.desired.fields,
      );
      const current = await this.resolveDesiredIdentifiers(
        change.actual.fields,
      );
      await context.manager.query(
        `DELETE FROM role_assignments
         WHERE user_id = $1 AND role_id = $2 AND scope_node_id = $3 AND managed_by = $4`,
        [
          current.userId,
          current.roleId,
          current.scopeNodeId,
          GITOPS_MANAGED_BY,
        ],
      );
      await context.manager.query(
        `INSERT INTO role_assignments (user_id, role_id, scope_node_id, managed_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, role_id, scope_node_id) DO NOTHING`,
        [
          resolved.userId,
          resolved.roleId,
          resolved.scopeNodeId,
          GITOPS_MANAGED_BY,
        ],
      );
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
    row: RoleAssignmentRow,
    scopePathById: Map<string, string>,
  ): GitOpsSerializedObject {
    const scopePath =
      scopePathById.get(row.scope_node_id) ?? `/${row.scope_node_id}`;
    return {
      objectType: this.objectType,
      key: `${row.username}:${row.role_name}:${scopePath}`,
      fields: {
        user: row.username,
        role: row.role_name,
        scope: scopePath,
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

  private async resolveDesiredIdentifiers(fields: {
    userId?: string;
    roleId?: string;
    scopeNodeId?: string;
    user?: string;
    role?: string;
    scope?: string;
  }): Promise<{ userId: string; roleId: string; scopeNodeId: string }> {
    if (fields.userId && fields.roleId && fields.scopeNodeId) {
      return {
        userId: fields.userId,
        roleId: fields.roleId,
        scopeNodeId: await this.resolveScopePathOrId(fields.scopeNodeId),
      };
    }

    if (!fields.user || !fields.role || !fields.scope) {
      throw new Error(
        'role_assignment requires either userId/roleId/scopeNodeId or user/role/scope',
      );
    }

    const user = await this.users.findByUsername(fields.user);
    if (!user) {
      throw new Error(`Unknown user '${fields.user}'`);
    }

    const role = await this.roles.findByName(fields.role);
    if (!role) {
      throw new Error(`Unknown role '${fields.role}'`);
    }

    const scopeNodeId = await this.resolveScopePathOrId(fields.scope);
    return { userId: user.id, roleId: role.id, scopeNodeId };
  }

  private async resolveScopePathOrId(scopeValue: string): Promise<string> {
    if (!scopeValue.startsWith('/')) {
      return scopeValue;
    }

    const tree = (await this.scope.getTree()) as ScopeTreeNodeLike | null;
    if (!tree) {
      throw new Error(`Unknown scope path '${scopeValue}'`);
    }

    if (scopeValue === '/') {
      return tree.id;
    }

    const segments = scopeValue
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean);
    let current: ScopeTreeNodeLike | null = tree;

    for (const segment of segments) {
      current =
        (current?.children ?? []).find((child) => child.slug === segment) ??
        null;
      if (!current) {
        throw new Error(`Unknown scope path '${scopeValue}'`);
      }
    }

    return current.id;
  }

  private async loadScopePathById(): Promise<Map<string, string>> {
    const tree = (await this.scope.getTree()) as ScopeTreeNodeLike | null;
    const paths = new Map<string, string>();
    if (!tree) {
      return paths;
    }

    const visit = (node: ScopeTreeNodeLike, parentPath: string): void => {
      const path =
        node.slug === ''
          ? '/'
          : parentPath === '/'
            ? `/${node.slug}`
            : `${parentPath}/${node.slug}`;
      paths.set(node.id, path);
      for (const child of node.children ?? []) {
        visit(child, path);
      }
    };

    visit(tree, '/');
    return paths;
  }
}
