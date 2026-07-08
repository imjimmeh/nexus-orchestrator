import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as toYaml } from 'yaml';
import { GitCommandService } from '../common/git/git-command/git-command.service';
import { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import { GitOpsPendingChange } from './database/entities/gitops-pending-change.entity';
import { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import { GitOpsReconcileRunRepository } from './database/repositories/gitops-reconcile-run.repository';
import { GitOpsObjectRegistryService } from './objects/gitops-object-registry.service';
import { GitOpsInvocationBuilder } from './gitops-invocation-builder';
import type {
  OutboundActorContext,
  OutboundSyncResult,
} from './gitops-outbound-sync.service.types';

@Injectable()
export class GitOpsOutboundSyncService {
  constructor(
    private readonly bindings: GitOpsRepositoryBindingRepository,
    private readonly pendingChanges: GitOpsPendingChangeRepository,
    private readonly runs: GitOpsReconcileRunRepository,
    private readonly registry: GitOpsObjectRegistryService,
    private readonly git: GitCommandService,
    private readonly invocationBuilder: GitOpsInvocationBuilder,
  ) {}

  async sync(
    scopeNodeId: string,
    bindingId: string,
    actor: OutboundActorContext,
  ): Promise<OutboundSyncResult> {
    const binding = await this.requireBinding(scopeNodeId, bindingId);
    const run = await this.runs.create({
      bindingId,
      direction: 'outbound',
      status: 'syncing',
      revision: binding.lastAppliedRevision ?? binding.defaultRef,
      summary: null,
      errors: [],
      startedAt: new Date(),
      finishedAt: null,
      actorUserId: actor.actorId,
    });

    try {
      const pending = await this.pendingChanges.findByBindingId(bindingId);
      const repoPath = this.workspacePath(bindingId);
      await this.checkout(binding, repoPath);
      const branchName = `gitops/${bindingId}/${Date.now()}`;
      await this.runCredentialedGit(binding, repoPath, [
        'checkout',
        '-B',
        branchName,
      ]);
      await this.writePendingChanges(repoPath, binding, pending);
      await this.runCredentialedGit(binding, repoPath, ['add', '.']);
      await this.runCredentialedGit(binding, repoPath, [
        'commit',
        '-m',
        `chore(gitops): sync ${pending.length} app change${pending.length === 1 ? '' : 's'}`,
      ]);
      await this.runCredentialedGit(binding, repoPath, [
        'push',
        'origin',
        branchName,
      ]);

      for (const change of pending) {
        await this.pendingChanges.update(change.id, { status: 'synced' });
      }

      await this.runs.update(run.id, {
        status: 'synced',
        revision: branchName,
        summary: JSON.stringify({ pendingChangeCount: pending.length }),
        finishedAt: new Date(),
      });
      return { bindingId, branchName, pendingChangeCount: pending.length };
    } catch (error) {
      await this.runs.update(run.id, {
        status: 'failed',
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        finishedAt: new Date(),
      });
      throw error;
    }
  }

  private async requireBinding(
    scopeNodeId: string,
    bindingId: string,
  ): Promise<GitOpsRepositoryBinding> {
    const binding = await this.bindings.findById(bindingId);
    if (!binding || binding.scopeNodeId !== scopeNodeId) {
      throw new NotFoundException(
        `GitOps repository binding ${bindingId} not found`,
      );
    }
    if (!binding.enabled) {
      throw new BadRequestException(
        `GitOps repository binding ${bindingId} is disabled`,
      );
    }
    if (binding.syncMode !== 'two_way') {
      throw new BadRequestException(
        'Outbound GitOps sync requires a two-way repository binding',
      );
    }
    return binding;
  }

  private async checkout(
    binding: GitOpsRepositoryBinding,
    repoPath: string,
  ): Promise<void> {
    if (fs.existsSync(path.join(repoPath, '.git'))) {
      await this.runCredentialedGit(binding, repoPath, [
        'fetch',
        '--prune',
        'origin',
        binding.defaultRef,
      ]);
      await this.runCredentialedGit(binding, repoPath, [
        'reset',
        '--hard',
        `origin/${binding.defaultRef}`,
      ]);
      return;
    }

    await mkdir(repoPath, { recursive: true });
    await this.runCredentialedGit(binding, repoPath, [
      'clone',
      '--depth',
      '1',
      '--branch',
      binding.defaultRef,
      '--',
      binding.repoUrl,
      '.',
    ]);
  }

  /**
   * Run a single git subcommand with the binding's resolved
   * credentials in scope. The credential-aware plan is
   * produced by `GitOpsInvocationBuilder` and the cleanup
   * hook (e.g. SSH temp file unlink) is awaited in
   * `finally` so the key file never outlives the invocation,
   * even when git fails.
   */
  private async runCredentialedGit(
    binding: GitOpsRepositoryBinding,
    cwd: string,
    args: string[],
  ): Promise<void> {
    const invocation = await this.invocationBuilder.build({
      binding,
      args,
      cwd,
    });
    try {
      await this.git.exec(invocation.cwd, invocation.args, invocation.env);
    } finally {
      await invocation.cleanup();
    }
  }

  private async writePendingChanges(
    repoPath: string,
    binding: GitOpsRepositoryBinding,
    pending: GitOpsPendingChange[],
  ): Promise<void> {
    for (const change of pending) {
      const handler = this.registry.getHandler(change.objectType);
      const normalized = handler.normalizeDesired({
        objectType: change.objectType,
        key: change.objectKey,
        fields: change.payload,
      });
      const serialized = handler.serialize({
        objectType: normalized.objectType,
        key: normalized.key,
        fields: normalized.fields,
        managedBy: 'gitops',
        locked: false,
      });
      const filePath = this.pendingFilePath(repoPath, binding, change);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        toYaml({ ...serialized, changeType: change.changeType }),
        'utf8',
      );
    }
  }

  private pendingFilePath(
    repoPath: string,
    binding: GitOpsRepositoryBinding,
    change: GitOpsPendingChange,
  ): string {
    const root = path.resolve(repoPath, binding.rootPath || '.');
    const filePath = path.resolve(
      root,
      'outbound',
      change.objectType,
      `${this.safeFileName(change.objectKey)}.yaml`,
    );
    if (!filePath.startsWith(root)) {
      throw new BadRequestException('Outbound sync path escapes binding root');
    }
    return filePath;
  }

  private workspacePath(bindingId: string): string {
    return path.join(
      process.env.NEXUS_WORKSPACE_BASE_PATH ?? '/tmp',
      'gitops',
      'outbound',
      bindingId,
    );
  }

  private safeFileName(key: string): string {
    return key.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
