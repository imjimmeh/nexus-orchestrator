import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ScopedAiDefaultEntity } from './entities/scoped-ai-default.entity.js';
import type { ScopedAiDefaultPatch } from './scoped-ai-default.types.js';

@Injectable()
export class ScopedAiDefaultRepository {
  constructor(
    @InjectRepository(ScopedAiDefaultEntity)
    private readonly repo: Repository<ScopedAiDefaultEntity>,
  ) {}

  /** Reads the single row for a scope. `null` = platform/global default. */
  getForScope(
    scopeNodeId: string | null,
  ): Promise<ScopedAiDefaultEntity | null> {
    return this.repo.findOneBy({
      scopeNodeId: scopeNodeId === null ? IsNull() : scopeNodeId,
    });
  }

  /**
   * Merges `patch` onto the existing row for the scope, or inserts a new one.
   * Find-then-save enforces the single platform (NULL-scope) row, which the DB
   * UNIQUE index cannot guarantee (Postgres treats NULL as distinct).
   */
  async upsertForScope(
    scopeNodeId: string | null,
    patch: ScopedAiDefaultPatch,
  ): Promise<ScopedAiDefaultEntity> {
    const existing = await this.repo.findOneBy({
      scopeNodeId: scopeNodeId === null ? IsNull() : scopeNodeId,
    });
    if (existing) {
      existing.harnessId =
        patch.harnessId !== undefined ? patch.harnessId : existing.harnessId;
      existing.modelName =
        patch.modelName !== undefined ? patch.modelName : existing.modelName;
      existing.providerName =
        patch.providerName !== undefined
          ? patch.providerName
          : existing.providerName;
      return this.repo.save(existing);
    }
    return this.repo.save({
      scopeNodeId,
      harnessId: patch.harnessId ?? null,
      modelName: patch.modelName ?? null,
      providerName: patch.providerName ?? null,
    });
  }

  /** Rows for the given non-null scope ids (used by the scope-walk resolver). */
  findForScopeIds(ids: string[]): Promise<ScopedAiDefaultEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repo.findBy({ scopeNodeId: In(ids) });
  }
}
