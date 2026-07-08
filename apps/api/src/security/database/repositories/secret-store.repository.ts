import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SecretStore } from '../entities/secret-store.entity';
import type { FindByOwnerAndNameParams } from './secret-store.repository.types';

@Injectable()
export class SecretStoreRepository {
  constructor(
    @InjectRepository(SecretStore)
    private readonly repository: Repository<SecretStore>,
  ) {}

  async findById(id: string): Promise<SecretStore | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<SecretStore | null> {
    return this.repository.findOne({ where: { name, owner_type: 'global' } });
  }

  async findByOwnerAndName(
    params: FindByOwnerAndNameParams,
  ): Promise<SecretStore | null> {
    return this.repository.findOne({
      where: {
        owner_type: params.ownerType,
        owner_id: params.ownerId ?? IsNull(),
        name: params.name,
      },
    });
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.repository.count({ where: { id } });
    return count > 0;
  }

  async findAll(options?: { scopeIds?: string[] }): Promise<SecretStore[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('secret')
      .orderBy('secret.created_at', 'DESC');

    // Only owner_type === 'scope' secrets reference the multi-tenant scope
    // node hierarchy; global/user-owned secrets are not scope-node-
    // partitioned and stay visible, matching the "platform/NULL stays
    // visible" pattern used elsewhere (e.g. WorkflowController.findAll).
    if (options?.scopeIds !== undefined) {
      if (options.scopeIds.length > 0) {
        queryBuilder.andWhere(
          "(secret.owner_type != 'scope' OR secret.owner_id = ANY(:scopeIds))",
          { scopeIds: options.scopeIds },
        );
      } else {
        queryBuilder.andWhere("secret.owner_type != 'scope'");
      }
    }

    return queryBuilder.getMany();
  }

  async create(data: Partial<SecretStore>): Promise<SecretStore> {
    const secret = this.repository.create(data);
    return this.repository.save(secret);
  }

  async update(
    id: string,
    data: Partial<SecretStore>,
  ): Promise<SecretStore | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const merged = this.repository.merge(existing, data);
    return this.repository.save(merged);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
