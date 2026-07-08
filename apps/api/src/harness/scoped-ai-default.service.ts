import { Injectable } from '@nestjs/common';
import { ScopedAiDefaultRepository } from './scoped-ai-default.repository.js';
import type { ScopedAiDefaultPatch } from './scoped-ai-default.types.js';
import type { ScopedAiDefaultEntity } from './entities/scoped-ai-default.entity.js';

@Injectable()
export class ScopedAiDefaultService {
  constructor(private readonly repo: ScopedAiDefaultRepository) {}

  getForScope(
    scopeNodeId: string | null,
  ): Promise<ScopedAiDefaultEntity | null> {
    return this.repo.getForScope(scopeNodeId);
  }

  setForScope(
    scopeNodeId: string | null,
    patch: ScopedAiDefaultPatch,
  ): Promise<ScopedAiDefaultEntity> {
    return this.repo.upsertForScope(scopeNodeId, patch);
  }
}
