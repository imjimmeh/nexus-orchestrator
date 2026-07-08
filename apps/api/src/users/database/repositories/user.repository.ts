import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository extends Repository<User> {
  constructor(private dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async findById(id: string): Promise<User | null> {
    return this.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.findOne({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        passwordHash: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async findWithRoles(userId: string): Promise<User | null> {
    return this.findOne({
      where: { id: userId },
      relations: { userRoles: { role: true } },
    });
  }

  async findActiveAdmins(): Promise<User[]> {
    return this.find({
      where: {
        isActive: true,
        userRoles: {
          role: {
            name: 'admin',
          },
        },
      },
      relations: { userRoles: { role: true } },
    });
  }

  async countActive(): Promise<number> {
    return this.count({ where: { isActive: true } });
  }
}
