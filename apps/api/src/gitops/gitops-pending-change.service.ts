import { Injectable } from '@nestjs/common';
import type { GitOpsSyncableObjectType } from '@nexus/core';
import type { GitOpsPendingChange } from './database/entities/gitops-pending-change.entity';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import { ScopeService } from '../scope/scope.service';
import { buildScopePathById } from './objects/gitops-object.helpers';

const PENDING_CHANGE_STATUS = 'pending';

@Injectable()
export class GitOpsPendingChangeService {
  constructor(
    private readonly pendingChanges: GitOpsPendingChangeRepository,
    private readonly scope: ScopeService,
  ) {}

  async recordConfigObjectChange(input: {
    binding: Pick<GitOpsRepositoryBinding, 'id' | 'lastAppliedRevision'>;
    objectType: GitOpsSyncableObjectType;
    scopeNodeId: string;
    name: string;
    changeType: string;
    payload: Record<string, unknown>;
    actorId?: string | null;
  }): Promise<void> {
    const objectKey = await this.buildConfigObjectKey(
      input.scopeNodeId,
      input.name,
    );
    const existing = await this.pendingChanges.findActiveByObject(
      input.binding.id,
      input.objectType,
      objectKey,
    );
    const data: Partial<GitOpsPendingChange> = {
      bindingId: input.binding.id,
      objectType: input.objectType,
      objectKey,
      scopeNodeId: input.scopeNodeId,
      changeType: input.changeType,
      payload: input.payload,
      baseRevision: input.binding.lastAppliedRevision,
      status: PENDING_CHANGE_STATUS,
      createdByUserId: input.actorId ?? null,
    };

    if (existing) {
      await this.pendingChanges.update(existing.id, data);
      return;
    }

    await this.pendingChanges.create(data);
  }

  private async buildConfigObjectKey(
    scopeNodeId: string,
    name: string,
  ): Promise<string> {
    const paths = await buildScopePathById(this.scope);
    const scopePath = paths.get(scopeNodeId) ?? scopeNodeId;
    return `${scopePath}:${name}`;
  }
}
