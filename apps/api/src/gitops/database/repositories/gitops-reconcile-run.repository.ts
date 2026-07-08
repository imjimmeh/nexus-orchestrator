import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { GitOpsReconcileRun } from '../entities/gitops-reconcile-run.entity';

@Injectable()
export class GitOpsReconcileRunRepository {
  constructor(
    @InjectRepository(GitOpsReconcileRun)
    private readonly repository: Repository<GitOpsReconcileRun>,
  ) {}

  async findById(id: string): Promise<GitOpsReconcileRun | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByBindingId(bindingId: string): Promise<GitOpsReconcileRun[]> {
    return this.repository.find({
      where: { bindingId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<GitOpsReconcileRun[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async create(data: Partial<GitOpsReconcileRun>): Promise<GitOpsReconcileRun> {
    return this.repository.save(this.repository.create(data));
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<GitOpsReconcileRun>,
  ): Promise<GitOpsReconcileRun | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
