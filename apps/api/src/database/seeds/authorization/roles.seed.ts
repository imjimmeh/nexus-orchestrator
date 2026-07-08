import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Role } from '../../../auth/database/entities/role.entity';
import {
  RESOURCES,
  resourceAdminRoleName,
  MEMBER_ADMIN_ROLE_NAME,
} from '../../../auth/authorization/permission-catalog';

type SeedRole = Pick<Role, 'name' | 'description'>;

const BASE_ROLES: SeedRole[] = [
  { name: 'admin', description: 'Full system access' },
  { name: 'user', description: 'Standard user access' },
  {
    name: 'platform_admin',
    description: 'Manage the entire platform and all scopes',
  },
  {
    name: 'tenant_admin',
    description: 'Full self-service within their tenant subtree',
  },
  { name: 'member', description: 'Read/create/update within assigned scopes' },
  { name: 'viewer', description: 'Read-only within assigned scopes' },
  { name: 'agent', description: 'Workflow agent access' },
];

/**
 * Builds the full seed role set: the broad roles plus one generated
 * `<resource>_admin` role per catalog resource and the `member_admin`
 * composite role. Derived from `permission-catalog` so the seed and the
 * catalog can never drift apart.
 */
export function buildSeedRoles(): SeedRole[] {
  const resourceAdmins: SeedRole[] = RESOURCES.map((resource) => ({
    name: resourceAdminRoleName(resource),
    description: `Manage all ${resource} within assigned scopes`,
  }));
  const memberAdmin: SeedRole = {
    name: MEMBER_ADMIN_ROLE_NAME,
    description: 'Manage members and roles within assigned scopes',
  };
  return [...BASE_ROLES, ...resourceAdmins, memberAdmin];
}

@Injectable()
export class RoleSeedService {
  private readonly logger = new Logger(RoleSeedService.name);

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async seed(): Promise<void> {
    for (const roleData of buildSeedRoles()) {
      const existing = await this.roleRepository.findOne({
        where: { name: roleData.name },
      });

      if (existing) {
        continue;
      }

      await this.roleRepository.save(this.roleRepository.create(roleData));
      this.logger.log(`Created role: ${roleData.name}`);
    }
  }
}

export async function seedRoles(dataSource: DataSource): Promise<void> {
  const service = new RoleSeedService(dataSource.getRepository(Role));
  await service.seed();
}
