import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../../../auth/database/entities/role.entity';
import { Permission } from '../../../auth/database/entities/permission.entity';
import { RolePermission } from '../../../auth/database/entities/role-permission.entity';
import {
  PERMISSION_CATALOG,
  permissionName,
  RESOURCES,
  resourceAdminRoleName,
  MEMBER_ADMIN_ROLE_NAME,
} from '../../../auth/authorization/permission-catalog';

const ALL_PERMISSION_NAMES = PERMISSION_CATALOG.map((p) => p.name);

/**
 * Builds the full role → permission-names mapping: the broad roles plus one
 * generated `<resource>_admin` → `<resource>:manage` mapping per catalog
 * resource and the `member_admin` composite mapping. The generated portion
 * is derived from `permission-catalog` so the seed and the catalog can never
 * drift apart.
 */
export function buildRolePermissionMappings(): Record<string, string[]> {
  const resourceAdmins: Record<string, string[]> = Object.fromEntries(
    RESOURCES.map((resource) => [
      resourceAdminRoleName(resource),
      [permissionName(resource, 'manage')],
    ]),
  );

  return {
    platform_admin: ALL_PERMISSION_NAMES,
    admin: ALL_PERMISSION_NAMES,
    tenant_admin: [
      permissionName('scopes', 'manage'),
      permissionName('resources', 'manage'),
      permissionName('workflows', 'manage'),
      permissionName('agents', 'manage'),
      permissionName('skills', 'manage'),
      permissionName('approvals', 'manage'),
      permissionName('goals', 'manage'),
      permissionName('memory', 'manage'),
      permissionName('budgets', 'manage'),
      permissionName('roles', 'manage'),
      permissionName('users', 'read'),
      permissionName('settings', 'read'),
    ],
    member: [
      permissionName('resources', 'read'),
      permissionName('resources', 'create'),
      permissionName('resources', 'update'),
      permissionName('workflows', 'read'),
      permissionName('workflows', 'create'),
      permissionName('workflows', 'update'),
      permissionName('agents', 'read'),
      permissionName('agents', 'create'),
      permissionName('agents', 'update'),
      permissionName('skills', 'read'),
      permissionName('skills', 'create'),
      permissionName('skills', 'update'),
      permissionName('goals', 'read'),
      permissionName('goals', 'create'),
      permissionName('goals', 'update'),
      permissionName('memory', 'read'),
      permissionName('memory', 'create'),
      permissionName('memory', 'update'),
      permissionName('scopes', 'read'),
      permissionName('approvals', 'read'),
      permissionName('budgets', 'read'),
    ],
    viewer: PERMISSION_CATALOG.filter((p) => p.action === 'read').map(
      (p) => p.name,
    ),
    agent: [
      permissionName('workflows', 'read'),
      permissionName('workflows', 'update'),
      permissionName('agents', 'read'),
      permissionName('agents', 'update'),
      permissionName('agents', 'manage'),
      permissionName('skills', 'read'),
      permissionName('skills', 'create'),
      permissionName('skills', 'update'),
      permissionName('skills', 'manage'),
      permissionName('memory', 'read'),
      permissionName('memory', 'create'),
      permissionName('memory', 'update'),
      permissionName('memory', 'manage'),
      permissionName('approvals', 'read'),
      permissionName('approvals', 'create'),
      permissionName('approvals', 'update'),
      permissionName('goals', 'read'),
      permissionName('goals', 'create'),
      permissionName('goals', 'update'),
      permissionName('settings', 'read'),
      permissionName('budgets', 'read'),
      permissionName('budgets', 'update'),
      permissionName('resources', 'read'),
      permissionName('resources', 'create'),
      permissionName('resources', 'update'),
    ],
    ...resourceAdmins,
    [MEMBER_ADMIN_ROLE_NAME]: [
      permissionName('roles', 'manage'),
      permissionName('users', 'manage'),
    ],
  };
}

export async function seedRolePermissions(
  dataSource: DataSource,
): Promise<void> {
  const logger = new Logger('seedRolePermissions');
  const roleRepo = dataSource.getRepository(Role);
  const permissionRepo = dataSource.getRepository(Permission);
  const rolePermissionRepo = dataSource.getRepository(RolePermission);

  for (const [roleName, permissionNames] of Object.entries(
    buildRolePermissionMappings(),
  )) {
    const role = await roleRepo.findOne({ where: { name: roleName } });
    if (!role) {
      logger.warn(
        `Role "${roleName}" not found — skipping permission assignment.`,
      );
      continue;
    }

    for (const permName of permissionNames) {
      const permission = await permissionRepo.findOne({
        where: { name: permName },
      });
      if (!permission) {
        logger.warn(`Permission "${permName}" not found — skipping.`);
        continue;
      }

      const existing = await rolePermissionRepo.findOne({
        where: { role: { id: role.id }, permission: { id: permission.id } },
      });

      if (existing) {
        continue;
      }

      const rolePermission = rolePermissionRepo.create({ role, permission });
      await rolePermissionRepo.save(rolePermission);
      logger.log(`Granted ${roleName} → ${permName}`);
    }
  }
}
