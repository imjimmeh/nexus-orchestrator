import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserRole } from '../entities/user-role.entity';

@Injectable()
export class UserRoleRepository extends Repository<UserRole> {
  constructor(private dataSource: DataSource) {
    super(UserRole, dataSource.createEntityManager());
  }

  async findByUserId(userId: string): Promise<UserRole[]> {
    return this.find({
      where: { user: { id: userId } },
      relations: { role: true },
    });
  }

  async findByRoleId(roleId: string): Promise<UserRole[]> {
    return this.find({
      where: { role: { id: roleId } },
      relations: { user: true },
    });
  }
}
