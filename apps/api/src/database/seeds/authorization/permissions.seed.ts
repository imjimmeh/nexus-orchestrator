import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Permission } from '../../../auth/database/entities/permission.entity';
import { PERMISSION_CATALOG } from '../../../auth/authorization/permission-catalog';

@Injectable()
export class PermissionSeedService {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async seed(): Promise<void> {
    for (const definition of PERMISSION_CATALOG) {
      const existing = await this.permissionRepository.findOne({
        where: { name: definition.name },
      });

      if (existing) {
        continue;
      }

      const entity = this.permissionRepository.create({
        name: definition.name,
        resource: definition.resource,
        action: definition.action,
      });
      await this.permissionRepository.save(entity);
      this.logger.log(`Created permission: ${definition.name}`);
    }
  }
}

export async function seedPermissions(dataSource: DataSource): Promise<void> {
  const service = new PermissionSeedService(
    dataSource.getRepository(Permission),
  );
  await service.seed();
}
