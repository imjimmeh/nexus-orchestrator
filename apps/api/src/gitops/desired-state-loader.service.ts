import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { GitCommandService } from '../common/git/git-command/git-command.service';
import { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import { GitOpsInvocationBuilder } from './gitops-invocation-builder';
import { ConfigValidationService } from './config-validation.service';
import { DESIRED_STATE_WORKSPACE_SUBPATH } from './gitops.constants';
import type { DesiredState } from './reconciliation.types';
import type { LoadDesiredStateInput } from './desired-state-loader.service.types';

const DESIRED_STATE_LAYOUT_ROOTS = new Set(['scopes', 'roles']);

const workspaceLocks = new Map<string, Promise<void>>();

@Injectable()
export class DesiredStateLoaderService {
  private readonly logger = new Logger(DesiredStateLoaderService.name);

  constructor(
    private readonly git: GitCommandService,
    private readonly validation: ConfigValidationService,
    private readonly invocationBuilder: GitOpsInvocationBuilder,
  ) {}

  async load(input: LoadDesiredStateInput): Promise<DesiredState> {
    const repoPath =
      input.workspacePath ??
      `${process.env.NEXUS_WORKSPACE_BASE_PATH ?? '/tmp'}${DESIRED_STATE_WORKSPACE_SUBPATH}`;

    return this.withWorkspaceLock(repoPath, async () => {
      this.assertSafeRepoUrl(input.repoUrl);

      // When the caller provided binding metadata, resolve
      // credentials for the inbound fetch/clone path. Without
      // it we fall back to the historical anonymous-fetch
      // path (used by the deprecated `ReconciliationService`
      // adapter, which sources repo config from
      // `GITOPS_REPO_URL` and has no notion of a binding).
      const binding = input.binding
        ? this.buildBindingStub(
            input.binding.id,
            input.repoUrl,
            input.binding.credentialsSecretId,
          )
        : null;

      if (fs.existsSync(`${repoPath}/.git`)) {
        if (binding) {
          const originUrl = (
            await this.runCredentialedGit(binding, repoPath, [
              'remote',
              'get-url',
              'origin',
            ])
          ).stdout.trim();

          if (originUrl !== input.repoUrl) {
            await rm(repoPath, { recursive: true, force: true });
            await mkdir(repoPath, { recursive: true });
            await this.runCredentialedGit(binding, repoPath, [
              'clone',
              '--depth',
              '1',
              '--branch',
              input.ref,
              '--',
              input.repoUrl,
              '.',
            ]);
          } else {
            await this.runCredentialedGit(binding, repoPath, [
              'fetch',
              '--prune',
              'origin',
              input.ref,
            ]);
            await this.runCredentialedGit(binding, repoPath, [
              'reset',
              '--hard',
              `origin/${input.ref}`,
            ]);
          }
        } else {
          const originUrl = (
            await this.git.exec(repoPath, ['remote', 'get-url', 'origin'])
          ).stdout.trim();

          if (originUrl !== input.repoUrl) {
            await rm(repoPath, { recursive: true, force: true });
            await mkdir(repoPath, { recursive: true });
            await this.git.exec(repoPath, [
              'clone',
              '--depth',
              '1',
              '--branch',
              input.ref,
              '--',
              input.repoUrl,
              '.',
            ]);
          } else {
            await this.git.exec(repoPath, [
              'fetch',
              '--prune',
              'origin',
              input.ref,
            ]);
            await this.git.exec(repoPath, [
              'reset',
              '--hard',
              `origin/${input.ref}`,
            ]);
          }
        }
      } else {
        await mkdir(repoPath, { recursive: true });
        if (binding) {
          await this.runCredentialedGit(binding, repoPath, [
            'clone',
            '--depth',
            '1',
            '--branch',
            input.ref,
            '--',
            input.repoUrl,
            '.',
          ]);
        } else {
          await this.git.exec(repoPath, [
            'clone',
            '--depth',
            '1',
            '--branch',
            input.ref,
            '--',
            input.repoUrl,
            '.',
          ]);
        }
      }

      const bindingRoot = await this.resolveBindingRoot(
        repoPath,
        input.rootPath,
      );
      return this.validation.loadAndValidate(
        bindingRoot.validationPath,
        undefined,
        {
          pathPrefix: bindingRoot.pathPrefix,
        },
      );
    });
  }

  /**
   * Build a minimal binding stub for the resolver. The
   * resolver only reads `id`, `repoUrl`, and
   * `credentialsSecretId`, so we populate the remaining
   * fields with safe placeholders. `as unknown as` keeps the
   * assertion narrowly scoped to the resolver's reading
   * surface; the loader never persists the stub.
   */
  private buildBindingStub(
    id: string,
    repoUrl: string,
    credentialsSecretId: string | null,
  ): GitOpsRepositoryBinding {
    return {
      id,
      scopeNodeId: 'desired-state-loader',
      name: 'desired-state-loader',
      repoUrl,
      defaultRef: '',
      rootPath: '.',
      syncMode: 'git_to_app',
      credentialsSecretId,
      enabled: true,
      includedObjectTypes: [],
      conflictPolicy: 'require_review',
      lastAppliedRevision: null,
      createdByUserId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  /**
   * Run a single git subcommand with the binding's resolved
   * credentials in scope. Mirrors the helper of the same name
   * on `GitOpsOutboundSyncService` so both code paths share
   * one credential-injection contract.
   */
  private async runCredentialedGit(
    binding: GitOpsRepositoryBinding,
    cwd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    const invocation = await this.invocationBuilder.build({
      binding,
      args,
      cwd,
    });
    try {
      return await this.git.exec(
        invocation.cwd,
        invocation.args,
        invocation.env,
      );
    } finally {
      await invocation.cleanup();
    }
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

  private async resolveBindingRoot(
    repoPath: string,
    rootPath?: string,
  ): Promise<{ validationPath: string; pathPrefix?: string }> {
    const resolvedRootPath = path.resolve(repoPath, rootPath ?? '.');

    if (!fs.existsSync(resolvedRootPath)) {
      throw new BadRequestException('Binding root path does not exist');
    }

    const [realRepoPath, realValidationPath] = await Promise.all([
      realpath(repoPath),
      realpath(resolvedRootPath),
    ]);
    const relativePath = path.relative(realRepoPath, realValidationPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new BadRequestException('Binding root path escapes the checkout');
    }

    const stats = await stat(realValidationPath);
    if (!stats.isDirectory()) {
      throw new BadRequestException('Binding root path must be a directory');
    }

    const normalizedRootPath = path.posix
      .normalize(
        path
          .relative(realRepoPath, realValidationPath)
          .split(path.sep)
          .join('/'),
      )
      .replace(/^\/+|\/+$/g, '');
    let pathPrefix: string | undefined;
    if (normalizedRootPath && normalizedRootPath !== '.') {
      const [firstSegment] = normalizedRootPath.split('/');
      if (firstSegment && DESIRED_STATE_LAYOUT_ROOTS.has(firstSegment)) {
        pathPrefix = normalizedRootPath;
      }
    }

    return { validationPath: realValidationPath, pathPrefix };
  }

  private async withWorkspaceLock<T>(
    workspacePath: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = workspaceLocks.get(workspacePath) ?? Promise.resolve();
    let release!: () => void;
    const current = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    workspaceLocks.set(workspacePath, current);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (workspaceLocks.get(workspacePath) === current) {
        workspaceLocks.delete(workspacePath);
      }
    }
  }
}
