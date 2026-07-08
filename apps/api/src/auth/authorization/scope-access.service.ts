import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface ScopeAccessRow {
  scope_id: string;
}

@Injectable()
export class ScopeAccessService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getAccessibleScopeIds(
    userId: string,
    permissionName: string,
  ): Promise<string[]> {
    const [resource] = permissionName.split(':');
    const managePermission = `${resource}:manage`;

    const rows = await this.dataSource.query<ScopeAccessRow[]>(
      `SELECT DISTINCT c.descendant_id AS scope_id
         FROM role_assignments ra
         JOIN role_permissions rp ON rp.role_id = ra.role_id
         JOIN permissions p ON p.id = rp.permission_id
         JOIN scope_node_closure c ON c.ancestor_id = ra.scope_node_id
        WHERE ra.user_id = $1
          AND p.name IN ($2, $3)`,
      [userId, permissionName, managePermission],
    );

    return [...new Set<string>(rows.map((r) => r.scope_id))];
  }

  /**
   * Default-deny scope filter for list endpoints: confines results to the
   * caller's accessible scope subtree. An out-of-subtree `requestedScopeId`
   * yields an empty set rather than falling back to the full accessible set.
   */
  async restrictToAccessibleScopes(
    userId: string,
    permissionName: string,
    requestedScopeId?: string,
  ): Promise<string[]> {
    const accessible = await this.getAccessibleScopeIds(userId, permissionName);
    if (!requestedScopeId) return accessible;
    return accessible.includes(requestedScopeId) ? [requestedScopeId] : [];
  }
}
