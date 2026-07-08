import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { GitOpsSyncableObjectType } from '@nexus/core';
import type { GitOpsRepositoryBinding } from '../database/entities/gitops-repository-binding.entity';
import type { GitOpsObjectHandler } from './gitops-object-handler.types';

export const GITOPS_OBJECT_HANDLERS = Symbol('GITOPS_OBJECT_HANDLERS');

@Injectable()
export class GitOpsObjectRegistryService {
  constructor(
    @Inject(GITOPS_OBJECT_HANDLERS)
    private readonly handlers: GitOpsObjectHandler[],
  ) {}

  getHandler(objectType: GitOpsSyncableObjectType): GitOpsObjectHandler {
    const handler = this.handlers.find(
      (candidate) => candidate.objectType === objectType,
    );
    if (!handler) {
      throw new BadRequestException(
        `Unsupported GitOps object type: ${objectType}`,
      );
    }

    return handler;
  }

  getHandlersForBinding(
    binding: Pick<GitOpsRepositoryBinding, 'includedObjectTypes'>,
  ): GitOpsObjectHandler[] {
    if (binding.includedObjectTypes.length === 0) {
      return [...this.handlers];
    }

    const allowed = new Set(binding.includedObjectTypes);
    return this.handlers.filter((handler) => allowed.has(handler.objectType));
  }
}
