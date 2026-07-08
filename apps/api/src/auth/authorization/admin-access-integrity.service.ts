import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import type { OrphanedLegacyRole } from './admin-access-integrity.service.types';

interface OrphanRow {
  user_id: string;
  role_id: string;
}

/**
 * Verifies the SDD §2.2 invariant: every legacy `user_roles` grant has a
 * corresponding root-scoped `role_assignment` (backfilled by migration
 * 20260609020000). Guards against a legacy admin being locked out once
 * `user_roles` is retired as an authority. Non-fatal: logs, never throws.
 */
@Injectable()
export class AdminAccessIntegrityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAccessIntegrityService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findLegacyRolesMissingRootAssignment(): Promise<OrphanedLegacyRole[]> {
    const rows = await this.dataSource.query<OrphanRow[]>(
      `SELECT ur.user_id, ur.role_id
         FROM user_roles ur
        WHERE NOT EXISTS (
          SELECT 1 FROM role_assignments ra
           WHERE ra.user_id = ur.user_id
             AND ra.role_id = ur.role_id
             AND ra.scope_node_id = $1
        )`,
      [GLOBAL_SCOPE_NODE_ID],
    );
    return rows.map((r) => ({ userId: r.user_id, roleId: r.role_id }));
  }

  async onApplicationBootstrap(): Promise<void> {
    let orphans: OrphanedLegacyRole[];
    try {
      orphans = await this.findLegacyRolesMissingRootAssignment();
    } catch (err) {
      this.logger.error(
        'Admin access integrity check failed to execute; skipping.',
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }
    if (orphans.length === 0) return;
    for (const orphan of orphans) {
      this.logger.error(
        `Legacy role grant (user=${orphan.userId}, role=${orphan.roleId}) has no ` +
          `root-scoped role_assignment; this user may be locked out. ` +
          `Re-run migration 20260609020000 or assign the role at the global root.`,
      );
    }
  }
}
