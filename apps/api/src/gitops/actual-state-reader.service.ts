import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../scope/scope.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import { reconcileKey } from './gitops.constants';
import type { ActualObject, ActualState } from './reconciliation.types';

interface ScopeNodeRow {
  id: string;
  parent_id: string | null;
  type: string;
  name: string;
  slug: string;
  managed_by: string | null;
  locked: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  owner_scope_node_id: string | null;
  managed_by: string | null;
  locked: boolean;
}

interface RolePermissionRow {
  role_id: string;
  name: string;
}

interface RoleAssignmentRow {
  user_id: string;
  username: string;
  role_id: string;
  role_name: string;
  scope_node_id: string;
  managed_by: string | null;
  locked: boolean;
}

@Injectable()
export class ActualStateReaderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async read(desiredKeys: Set<string>): Promise<ActualState> {
    const objects: ActualObject[] = [];

    // scope_nodes
    const nodes: ScopeNodeRow[] = await this.dataSource.query(
      `SELECT id, parent_id, type, name, slug, managed_by, locked FROM scope_nodes`,
    );

    const idToPath = this.buildIdToPathMap(nodes);

    for (const n of nodes) {
      objects.push(await this.readScopeNodeObject(n, idToPath, desiredKeys));
    }

    // roles
    const roles: RoleRow[] = await this.dataSource.query(
      `SELECT id, name, description, owner_scope_node_id, managed_by, locked FROM roles`,
    );
    const rolePermissions: RolePermissionRow[] = await this.dataSource.query(
      `SELECT rp.role_id, p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`,
    );
    const permissionsByRole = new Map<string, string[]>();
    for (const row of rolePermissions) {
      const current = permissionsByRole.get(row.role_id) ?? [];
      current.push(row.name);
      permissionsByRole.set(row.role_id, current);
    }
    for (const r of roles) {
      objects.push({
        type: 'role',
        key: r.name,
        fields: {
          description: r.description,
          ownerScope: r.owner_scope_node_id
            ? (idToPath.get(r.owner_scope_node_id) ??
              `/${r.owner_scope_node_id}`)
            : null,
          permissions: permissionsByRole.get(r.id) ?? [],
        },
        managedBy: r.managed_by,
        locked: r.locked,
      });
    }

    // role_assignments
    const assignments: RoleAssignmentRow[] = await this.dataSource.query(
      `SELECT ra.user_id, u.username, ra.role_id, r.name AS role_name, ra.scope_node_id, ra.managed_by, ra.locked
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id
       JOIN roles r ON r.id = ra.role_id`,
    );
    for (const a of assignments) {
      const scopePath = idToPath.get(a.scope_node_id) ?? `/${a.scope_node_id}`;
      objects.push({
        type: 'role_assignment',
        key: `${a.username}:${a.role_name}:${scopePath}`,
        fields: {
          user: a.username,
          role: a.role_name,
          scope: scopePath,
        },
        managedBy: a.managed_by,
        locked: a.locked,
      });
    }

    return { objects };
  }

  /**
   * Builds an id→path map using the same slug-path algorithm as ConfigExportService
   * so that keys match what gitops-contracts uses (e.g. `/orgs/acme`).
   */
  private buildIdToPathMap(nodes: ScopeNodeRow[]): Map<string, string> {
    const byId = new Map<string, ScopeNodeRow>();
    for (const n of nodes) byId.set(n.id, n);

    const cache = new Map<string, string>();
    const pathOf = (id: string): string => {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      if (id === GLOBAL_SCOPE_NODE_ID) {
        cache.set(id, '/');
        return '/';
      }
      const node = byId.get(id);
      if (!node) return `/${id}`;
      const parentPath = node.parent_id ? pathOf(node.parent_id) : '/';
      const p =
        parentPath === '/' ? `/${node.slug}` : `${parentPath}/${node.slug}`;
      cache.set(id, p);
      return p;
    };

    const idToPath = new Map<string, string>();
    for (const n of nodes) idToPath.set(n.id, pathOf(n.id));
    return idToPath;
  }

  private async readScopeNodeObject(
    n: ScopeNodeRow,
    idToPath: Map<string, string>,
    desiredKeys: Set<string>,
  ): Promise<ActualObject> {
    const key = idToPath.get(n.id) ?? `/${n.id}`;
    let hasForeignDescendants = false;
    // Foreign-descendant check only matters for managed nodes; unmanaged nodes cannot
    // be pruned by GitOps regardless, so the expensive getDescendantIds call is skipped.
    if (n.managed_by) {
      const descendants = await this.scope.getDescendantIds(n.id);
      hasForeignDescendants = descendants.some((d) => {
        if (d === n.id) return false;
        const descendantPath = idToPath.get(d);
        return (
          descendantPath === undefined ||
          !desiredKeys.has(reconcileKey('scope_node', descendantPath))
        );
      });
    }
    return {
      type: 'scope_node',
      key,
      fields: {
        id: n.id,
        type: n.type,
        name: n.name,
        slug: n.slug,
        parentId: n.parent_id,
        path: key,
      },
      managedBy: n.managed_by,
      locked: n.locked,
      hasForeignDescendants,
    };
  }
}
