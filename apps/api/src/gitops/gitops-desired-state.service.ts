import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { join } from 'node:path';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import { DesiredStateLoaderService } from './desired-state-loader.service';
import type { DesiredState } from './reconciliation.types';
import type { LoadForBindingContext } from './gitops-desired-state.service.types';

@Injectable()
export class GitOpsDesiredStateService {
  private readonly logger = new Logger(GitOpsDesiredStateService.name);

  constructor(
    private readonly bindingRepository: GitOpsRepositoryBindingRepository,
    private readonly loader: DesiredStateLoaderService,
  ) {}

  async loadForBinding(
    bindingId: string,
    actorContext: LoadForBindingContext,
  ): Promise<DesiredState> {
    const binding = await this.bindingRepository.findById(bindingId);
    if (!binding) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }

    if (!binding.enabled) {
      throw new BadRequestException(
        `GitOps repository binding ${bindingId} is disabled`,
      );
    }

    this.logger.debug(
      `Loading binding ${bindingId} for actor ${actorContext.actorId}`,
    );

    const workspacePath = this.resolveWorkspacePath(bindingId);
    return this.loader.load({
      repoUrl: binding.repoUrl,
      ref: binding.defaultRef,
      rootPath: binding.rootPath,
      workspacePath,
      // Thread the binding's `credentialsSecretId` through to
      // the loader so the inbound fetch/clone resolves and
      // applies credentials via `GitOpsCredentialsResolver`
      // + `GitOpsInvocationBuilder`. Anonymous mode still
      // applies when `credentialsSecretId` is null. Defensively
      // normalise `undefined` to `null` to match the entity
      // column type and so test fixtures / partial binding
      // payloads resolve to anonymous mode rather than
      // throwing on a missing field.
      binding: {
        id: binding.id,
        credentialsSecretId: binding.credentialsSecretId ?? null,
      },
    });
  }

  private resolveWorkspacePath(bindingId: string): string {
    const basePath = process.env.NEXUS_WORKSPACE_BASE_PATH ?? '/tmp';
    return join(basePath, 'gitops', 'bindings', bindingId);
  }
}
