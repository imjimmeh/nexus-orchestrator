import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ScopedVariableAudit } from '../entities/scoped-variable-audit.entity';
import type { RecordAuditInput } from './scoped-variable-audit.repository.types';

export type { RecordAuditInput } from './scoped-variable-audit.repository.types';

@Injectable()
export class ScopedVariableAuditRepository {
  constructor(
    @InjectRepository(ScopedVariableAudit)
    private readonly repo: Repository<ScopedVariableAudit>,
  ) {}

  async record(input: RecordAuditInput): Promise<void> {
    await this.repo.save(
      this.repo.create({
        scope_node_id: input.scopeNodeId,
        key: input.key,
        action: input.action,
        previous_value: input.previousValue ?? null,
        new_value: input.newValue ?? null,
        actor: input.actor ?? null,
      }),
    );
  }

  async listFor(
    scopeNodeId: string | null,
    key?: string,
  ): Promise<ScopedVariableAudit[]> {
    return this.repo.find({
      where: {
        scope_node_id: scopeNodeId === null ? IsNull() : scopeNodeId,
        ...(key ? { key } : {}),
      },
      order: { created_at: 'DESC' },
      take: 200,
    });
  }
}
