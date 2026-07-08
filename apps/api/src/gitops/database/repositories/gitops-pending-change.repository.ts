import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { GitOpsSyncableObjectType } from '@nexus/core';
import { GitOpsPendingChange } from '../entities/gitops-pending-change.entity';

const ACTIVE_PENDING_CHANGE_STATUS = 'pending';

@Injectable()
export class GitOpsPendingChangeRepository {
  constructor(
    @InjectRepository(GitOpsPendingChange)
    private readonly repository: Repository<GitOpsPendingChange>,
  ) {}

  async findById(id: string): Promise<GitOpsPendingChange | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByBindingId(bindingId: string): Promise<GitOpsPendingChange[]> {
    return this.repository.find({
      where: { bindingId, status: ACTIVE_PENDING_CHANGE_STATUS },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveByObject(
    bindingId: string,
    objectType: GitOpsSyncableObjectType,
    objectKey: string,
  ): Promise<GitOpsPendingChange | null> {
    return this.repository.findOne({
      where: {
        bindingId,
        objectType,
        objectKey,
        status: ACTIVE_PENDING_CHANGE_STATUS,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<GitOpsPendingChange[]> {
    return this.repository.find({
      where: { status: ACTIVE_PENDING_CHANGE_STATUS },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    data: Partial<GitOpsPendingChange>,
  ): Promise<GitOpsPendingChange> {
    return this.repository.save(this.repository.create(data));
  }

  async update(
    id: string,
    data: Partial<GitOpsPendingChange>,
  ): Promise<GitOpsPendingChange | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    Object.assign(existing, data);
    return this.repository.save(existing);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
