import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { GitOpsRepositoryBinding } from '../entities/gitops-repository-binding.entity';

@Injectable()
export class GitOpsRepositoryBindingRepository {
  constructor(
    @InjectRepository(GitOpsRepositoryBinding)
    private readonly repository: Repository<GitOpsRepositoryBinding>,
  ) {}

  async findById(id: string): Promise<GitOpsRepositoryBinding | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByScopeNodeId(
    scopeNodeId: string,
  ): Promise<GitOpsRepositoryBinding[]> {
    return this.repository.find({
      where: { scopeNodeId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<GitOpsRepositoryBinding[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async create(
    data: Partial<GitOpsRepositoryBinding>,
  ): Promise<GitOpsRepositoryBinding> {
    return this.repository.save(this.repository.create(data));
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<GitOpsRepositoryBinding>,
  ): Promise<GitOpsRepositoryBinding | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
