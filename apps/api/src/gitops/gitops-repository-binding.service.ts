import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isGitOpsBindingSyncMode } from '@nexus/core';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import type {
  CreateGitOpsRepositoryBindingDto,
  UpdateGitOpsRepositoryBindingDto,
} from './dto/gitops-repository-binding.dto.types';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

@Injectable()
export class GitOpsRepositoryBindingService {
  constructor(private readonly repository: GitOpsRepositoryBindingRepository) {}

  async create(
    input: CreateGitOpsRepositoryBindingDto,
  ): Promise<GitOpsRepositoryBinding> {
    this.assertSafeRepoUrl(input.repoUrl);
    this.assertValidSyncMode(input.syncMode);

    return this.repository.create({
      scopeNodeId: input.scopeNodeId,
      name: input.name,
      repoUrl: input.repoUrl,
      defaultRef: input.defaultRef ?? 'main',
      rootPath: input.rootPath ?? '.',
      syncMode: input.syncMode,
      credentialsSecretId: input.credentialsSecretId ?? null,
      enabled: true,
      includedObjectTypes: input.includedObjectTypes,
    });
  }

  async list(scopeNodeId: string): Promise<GitOpsRepositoryBinding[]> {
    return this.repository.findByScopeNodeId(scopeNodeId);
  }

  /**
   * Return every enabled `GitOpsRepositoryBinding` across all
   * scope nodes in a deterministic order (id ascending). Used
   * by the scheduled reconciliation tick to fan out across all
   * active bindings.
   *
   * The id-ascending order is intentional: it removes the
   * previous non-determinism where the per-scope
   * `findByScopeNodeId` order was `createdAt DESC`. The
   * reconciler tick must be deterministic so the audit-log
   * diff between two consecutive ticks is stable (otherwise
   * a re-run of the tick would mutate the audit row order).
   */
  async listActive(): Promise<GitOpsRepositoryBinding[]> {
    const bindings = await this.repository.findAll();
    return bindings
      .filter((binding) => binding.enabled)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(
    bindingId: string,
    scopeNodeId: string,
  ): Promise<GitOpsRepositoryBinding> {
    const binding = await this.repository.findById(bindingId);
    if (!binding || binding.scopeNodeId !== scopeNodeId) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }
    return binding;
  }

  async update(
    bindingId: string,
    scopeNodeId: string,
    input: UpdateGitOpsRepositoryBindingDto,
  ): Promise<GitOpsRepositoryBinding> {
    const existing = await this.get(bindingId, scopeNodeId);
    const nextRepoUrl = input.repoUrl ?? existing.repoUrl;
    const nextSyncMode = input.syncMode ?? existing.syncMode;

    const next = {
      name: input.name ?? existing.name,
      repoUrl: nextRepoUrl,
      defaultRef: input.defaultRef ?? existing.defaultRef,
      rootPath: input.rootPath ?? existing.rootPath,
      syncMode: nextSyncMode,
      credentialsSecretId:
        input.credentialsSecretId === undefined
          ? existing.credentialsSecretId
          : input.credentialsSecretId,
      includedObjectTypes:
        input.includedObjectTypes ?? existing.includedObjectTypes,
    };

    this.assertSafeRepoUrl(nextRepoUrl);
    this.assertValidSyncMode(nextSyncMode);

    const updated = await this.repository.update(bindingId, {
      scopeNodeId,
      ...next,
      credentialsSecretId: next.credentialsSecretId ?? null,
    });

    if (!updated) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }

    return updated;
  }

  async disable(
    bindingId: string,
    scopeNodeId: string,
  ): Promise<GitOpsRepositoryBinding> {
    await this.get(bindingId, scopeNodeId);
    const updated = await this.repository.update(bindingId, { enabled: false });

    if (!updated) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }

    return updated;
  }

  private assertSafeRepoUrl(repoUrl: string): void {
    let url: URL;
    try {
      url = new URL(repoUrl);
    } catch {
      throw new BadRequestException('Invalid repository URL');
    }

    if (url.username || url.password) {
      throw new BadRequestException(
        'Repository URL must not include credentials',
      );
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException('Repository URL must be HTTPS');
    }
  }

  private assertValidSyncMode(syncMode: string): void {
    if (!isGitOpsBindingSyncMode(syncMode)) {
      throw new BadRequestException('Invalid sync mode');
    }
  }
}
