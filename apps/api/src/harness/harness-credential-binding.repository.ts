import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { HarnessCredentialBindingEntity } from './entities/harness-credential-binding.entity.js';
import type { UpsertHarnessCredentialBinding } from './harness-credential-binding.types.js';

@Injectable()
export class HarnessCredentialBindingRepository {
  constructor(
    @InjectRepository(HarnessCredentialBindingEntity)
    private readonly repo: Repository<HarnessCredentialBindingEntity>,
  ) {}

  findBinding(
    scopeNodeId: string | null,
    harnessId: string,
    credentialKey: string,
  ): Promise<HarnessCredentialBindingEntity | null> {
    const where: FindOptionsWhere<HarnessCredentialBindingEntity> = {
      harnessId,
      credentialKey,
      scopeNodeId: scopeNodeId === null ? IsNull() : scopeNodeId,
    };
    return this.repo.findOneBy(where);
  }

  /**
   * Returns the first binding for (harnessId, credentialKey) whose scope_node_id
   * matches one of `scopeNodeIds`, in the order the ids were supplied (caller
   * passes them most-specific -> platform -> null).
   */
  async findForScopeChain(
    scopeNodeIds: Array<string | null>,
    harnessId: string,
    credentialKey: string,
  ): Promise<HarnessCredentialBindingEntity | null> {
    const nonNullIds = scopeNodeIds.filter((id): id is string => id !== null);
    const includesPlatform = scopeNodeIds.includes(null);

    const rows = await this.repo.find({
      where: [
        ...(nonNullIds.length > 0
          ? [{ harnessId, credentialKey, scopeNodeId: In(nonNullIds) }]
          : []),
        ...(includesPlatform
          ? [{ harnessId, credentialKey, scopeNodeId: IsNull() }]
          : []),
      ],
    });

    const byScope = new Map<string | null, HarnessCredentialBindingEntity>();
    for (const row of rows) {
      if (!byScope.has(row.scopeNodeId)) byScope.set(row.scopeNodeId, row);
    }

    for (const scopeNodeId of scopeNodeIds) {
      const match = byScope.get(scopeNodeId);
      if (match) return match;
    }
    return null;
  }

  upsert(
    binding: UpsertHarnessCredentialBinding,
  ): Promise<HarnessCredentialBindingEntity> {
    return this.repo.save(binding);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  listForHarness(harnessId: string): Promise<HarnessCredentialBindingEntity[]> {
    return this.repo.find({ where: { harnessId } });
  }
}
