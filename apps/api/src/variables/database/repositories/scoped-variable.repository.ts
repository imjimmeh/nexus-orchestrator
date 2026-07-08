import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ScopedVariable } from '../entities/scoped-variable.entity';
import { ScopedVariableAuditRepository } from './scoped-variable-audit.repository';
import type { UpsertScopedVariableRequest } from '@nexus/core';

@Injectable()
export class ScopedVariableRepository {
  constructor(
    @InjectRepository(ScopedVariable)
    private readonly repository: Repository<ScopedVariable>,
    private readonly auditRepo: ScopedVariableAuditRepository,
  ) {}

  findGlobals(): Promise<ScopedVariable[]> {
    return this.repository.find({ where: { scope_node_id: IsNull() } });
  }

  async findByScopeIds(scopeIds: string[]): Promise<ScopedVariable[]> {
    if (scopeIds.length === 0) {
      return [];
    }
    return this.repository.find({ where: { scope_node_id: In(scopeIds) } });
  }

  findOneByKeyAndScope(
    key: string,
    scopeNodeId: string | null,
  ): Promise<ScopedVariable | null> {
    return this.repository.findOne({
      where: { key, scope_node_id: scopeNodeId ?? IsNull() },
    });
  }

  listForScope(scopeNodeId: string | null): Promise<ScopedVariable[]> {
    return this.repository.find({
      where: { scope_node_id: scopeNodeId ?? IsNull() },
      order: { key: 'ASC' },
    });
  }

  async upsert(
    input: UpsertScopedVariableRequest,
    actor: string | null = null,
  ): Promise<ScopedVariable> {
    const existing = await this.findOneByKeyAndScope(
      input.key,
      input.scopeNodeId,
    );
    // Capture the prior value before persisting so the audit trail records the
    // transition rather than the post-write state.
    const previousValue = existing?.value ?? null;

    const entity = this.repository.create({
      id: existing?.id,
      source: existing?.source,
      created_by: existing?.created_by ?? actor,
      updated_by: actor,
      scope_node_id: input.scopeNodeId,
      key: input.key,
      value: input.value,
      value_type: input.valueType,
      description: input.description ?? null,
    });
    const saved = await this.repository.save(entity);

    await this.auditRepo.record({
      scopeNodeId: input.scopeNodeId,
      key: input.key,
      action: 'upsert',
      previousValue,
      newValue: input.value,
      actor,
    });

    return saved;
  }

  async deleteByKeyAndScope(
    key: string,
    scopeNodeId: string | null,
    actor: string | null = null,
  ): Promise<void> {
    const prior = await this.findOneByKeyAndScope(key, scopeNodeId);
    if (!prior) {
      return;
    }

    await this.repository.delete({
      key,
      scope_node_id: scopeNodeId ?? IsNull(),
    });

    await this.auditRepo.record({
      scopeNodeId,
      key,
      action: 'delete',
      previousValue: prior.value,
      newValue: null,
      actor,
    });
  }
}
