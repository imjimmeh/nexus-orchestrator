import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { isErrorEnvelope, errorEnvelopeToString } from '@nexus/core';
import { GitCommandService } from './git-command/git-command.service';
import { BranchOperationsService } from './branch/branch-operations.service';
import { RepositoryLockService } from './locking/repository-lock.service';
import { GitPathService } from './path/git-path.service';
import { WorktreeOperationsService } from './worktree/worktree-operations.service';
import {
  GitWorktreeEntry,
  isWorktreeInitialized,
} from './worktree/worktree.types';
import { EventLedgerService } from '../../observability/event-ledger.service';
import {
  ProvisionWorktreeWithinLockParams,
  RemoveWorktreeWithinLockParams,
} from './git-worktree.types';
import {
  deleteBranchBestEffort,
  pushBranchBestEffort,
  pruneWorktreesBestEffort,
} from './git-worktree-ops.util';
import {
  hasLinkedWorktreeGitMarker,
  pathExists,
  removeOrphanDirectory,
  removeStaleWorktreeRegistration,
  validateWorktreePath,
} from './git-worktree-provision.util';
import {
  isInvalidWorktreeGitdirError,
  resolveManagedRoot,
} from './git-worktree-helpers.util';
import { buildGitRepositoryPathCandidates } from './git-repository-path-candidates.util';

@Injectable()
export class GitWorktreeService {
  private readonly logger = new Logger(GitWorktreeService.name);

  constructor(
    private readonly gitCommand: GitCommandService,
    private readonly branchOps: BranchOperationsService,
    private readonly lockService: RepositoryLockService,
    private readonly pathService: GitPathService,
    private readonly worktreeOps: WorktreeOperationsService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  getWorktreePath(scopeId: string, contextId: string): string {
    return this.pathService.getWorktreePath(scopeId, contextId);
  }

  async provisionWorktree(
    scopeId: string,
    contextId: string,
    baseBranch: string,
    targetBranch: string,
  ): Promise<string> {
    if (!baseBranch.trim() || !targetBranch.trim()) {
      throw new BadRequestException(
        'Base branch and target branch are required for worktree provisioning',
      );
    }
    await this.eventLedger.emitBestEffort({
      domain: 'git',
      eventName: 'git.worktree.provision.requested',
      outcome: 'in_progress',
      context: {
        scopeId: scopeId,
        contextId: contextId,
        contextType: 'resource',
        scopeNodeId: null,
        scopePath: null,
      },
      payload: { baseBranch, targetBranch },
    });
    try {
      const repoPath = await this.resolveProjectRepoPath(scopeId);
      const worktreePath = this.pathService.getWorktreePath(scopeId, contextId);
      await mkdir(path.dirname(worktreePath), { recursive: true });
      const provisionedPath = await this.provisionWorktreeWithinLock({
        repoPath,
        worktreePath,
        scopeId,
        contextId,
        baseBranch,
        targetBranch,
      });
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.worktree.provision.succeeded',
        outcome: 'success',
        context: {
          scopeId: scopeId,
          contextId: contextId,
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        payload: {
          worktreePath: provisionedPath,
          baseBranch,
          targetBranch,
        },
      });
      return provisionedPath;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.worktree.provision.failed',
        outcome: 'failure',
        context: {
          scopeId: scopeId,
          contextId: contextId,
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        payload: { baseBranch, targetBranch },
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async removeWorktree(
    scopeId: string,
    contextId: string,
    targetBranch?: string,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'git',
      eventName: 'git.worktree.remove.requested',
      outcome: 'in_progress',
      context: {
        scopeId: scopeId,
        contextId: contextId,
        contextType: 'resource',
        scopeNodeId: null,
        scopePath: null,
      },
      payload: { targetBranch },
    });
    try {
      const repoPath = await this.resolveProjectRepoPath(scopeId);
      const worktreePath = this.pathService.getWorktreePath(scopeId, contextId);
      await this.removeWorktreeWithinLock({
        repoPath,
        worktreePath,
        scopeId,
        contextId,
        targetBranch,
      });
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.worktree.remove.succeeded',
        outcome: 'success',
        context: {
          scopeId: scopeId,
          contextId: contextId,
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        payload: { targetBranch },
      });
    } catch (error) {
      const errorMessage = isErrorEnvelope(error)
        ? errorEnvelopeToString(error)
        : (error as Error).message;
      await this.eventLedger.emitBestEffort({
        domain: 'git',
        eventName: 'git.worktree.remove.failed',
        outcome: 'failure',
        context: {
          scopeId: scopeId,
          contextId: contextId,
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        payload: { targetBranch },
        errorMessage,
      });
      throw error;
    }
  }

  async listManagedWorktrees(scopeId: string): Promise<GitWorktreeEntry[]> {
    const repoPath = await this.resolveProjectRepoPath(scopeId);
    const managedRoot = resolveManagedRoot(
      this.pathService.getWorktreeBasePath(),
      scopeId,
    );
    return this.lockService.runRepoExclusive(repoPath, async () => {
      const worktrees = await this.worktreeOps.listWorktrees(repoPath);
      return worktrees.filter((entry) =>
        this.pathService.isWithinRoot(entry.path, managedRoot),
      );
    });
  }

  async resolveProjectDefaultBranch(
    scopeId: string,
    hint?: string,
  ): Promise<string | null> {
    const repoPath = await this.resolveProjectRepoPath(scopeId);
    if (!repoPath) return null;
    return this.branchOps.resolveDefaultBranch(repoPath, hint);
  }

  async listManagedWorktreeDirectories(scopeId: string): Promise<string[]> {
    const managedRoot = resolveManagedRoot(
      this.pathService.getWorktreeBasePath(),
      scopeId,
    );
    try {
      const entries = await readdir(managedRoot, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(managedRoot, entry.name));
    } catch {
      return [];
    }
  }

  async getExistingWorktreePath(
    scopeId: string,
    contextId: string,
  ): Promise<string | null> {
    const repoPath = await this.resolveProjectRepoPath(scopeId);
    const worktreePath = this.pathService.getWorktreePath(scopeId, contextId);
    return this.lockService.runRepoExclusive(repoPath, () =>
      validateWorktreePath({
        worktreeOps: this.worktreeOps,
        logger: this.logger,
        repoPath,
        worktreePath,
        scopeId,
        contextId,
      }),
    );
  }

  pushBranch(
    repoPath: string,
    branchName: string,
    context?: { scopeId?: string; contextId?: string },
  ): Promise<boolean> {
    return pushBranchBestEffort({
      branchOps: this.branchOps,
      gitCommand: this.gitCommand,
      eventLedger: this.eventLedger,
      logger: this.logger,
      repoPath,
      branchName,
      context,
    });
  }

  async resolveProjectBasePath(scopeId: string): Promise<string> {
    return this.resolveProjectRepoPath(scopeId);
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    baseRef?: string,
  ): Promise<void> {
    await this.branchOps.createBranch(repoPath, branchName, baseRef);
  }

  private async resolveProjectRepoPath(scopeId: string): Promise<string> {
    const sanitizedScopeId = scopeId.trim();
    if (!sanitizedScopeId) {
      throw new BadRequestException('Repository path is required');
    }

    let lastError: unknown = null;
    for (const candidatePath of buildGitRepositoryPathCandidates(
      sanitizedScopeId,
    )) {
      try {
        return await this.pathService.resolveGitRepoPath(candidatePath);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new BadRequestException(
      `Project base path is not a git repository: ${sanitizedScopeId}`,
    );
  }

  private async provisionWorktreeWithinLock(
    params: ProvisionWorktreeWithinLockParams,
  ): Promise<string> {
    return this.lockService.runRepoExclusive(params.repoPath, async () => {
      const existing = await this.worktreeOps.findWorktreeByPath(
        params.repoPath,
        params.worktreePath,
      );
      if (existing) {
        if (isWorktreeInitialized(existing)) {
          this.logger.log(
            `Worktree already exists for project=${params.scopeId} context=${params.contextId}: ${params.worktreePath}`,
          );
          return params.worktreePath;
        }
        await removeStaleWorktreeRegistration({
          worktreeOps: this.worktreeOps,
          eventLedger: this.eventLedger,
          logger: this.logger,
          repoPath: params.repoPath,
          worktreePath: params.worktreePath,
          scopeId: params.scopeId,
          contextId: params.contextId,
        });
      }
      if (await pathExists(params.worktreePath)) {
        if (!(await hasLinkedWorktreeGitMarker(params.worktreePath))) {
          this.logger.warn(
            `Detected stale unregistered worktree directory or invalid .git marker for ${params.scopeId}/${params.contextId}; cleaning ${params.worktreePath} before provisioning`,
          );
          await removeOrphanDirectory({
            logger: this.logger,
            scopeId: params.scopeId,
            contextId: params.contextId,
            worktreePath: params.worktreePath,
          });
        }
      }
      const conflictingWorktree = await this.findManagedWorktreeUsingBranch({
        repoPath: params.repoPath,
        scopeId: params.scopeId,
        targetBranch: params.targetBranch,
        requestedWorktreePath: params.worktreePath,
      });
      if (conflictingWorktree) {
        throw new BadRequestException(
          `Target branch ${params.targetBranch} is already checked out by managed worktree ${conflictingWorktree.path}`,
        );
      }
      // Idempotency: return existing path if worktree already registered at target
      const existingRegistration = await this.worktreeOps.findWorktreeByPath(
        params.repoPath,
        params.worktreePath,
      );
      if (existingRegistration) {
        return existingRegistration.path;
      }

      const hasTargetBranch = await this.branchOps.hasLocalBranch(
        params.repoPath,
        params.targetBranch,
      );
      if (hasTargetBranch) {
        // Reused branch: refresh it onto the freshly fetched base when it can
        // be cleanly fast-forwarded (a stale, work-free pointer). Branches that
        // carry real work are preserved, but their staleness is surfaced so a
        // branch cut from an outdated base never goes unnoticed.
        const resolvedBaseRef = await this.branchOps.resolveBaseRef(
          params.repoPath,
          params.baseBranch,
        );
        const syncResult = await this.branchOps.fastForwardBranchToBase(
          params.repoPath,
          params.targetBranch,
          resolvedBaseRef,
        );
        if (syncResult === 'preserved') {
          await this.eventLedger.emitBestEffort({
            domain: 'git',
            eventName: 'git.worktree.branch.stale',
            outcome: 'success',
            severity: 'warn',
            context: {
              scopeId: params.scopeId,
              contextId: params.contextId,
              contextType: 'resource',
              scopeNodeId: null,
              scopePath: null,
            },
            payload: {
              targetBranch: params.targetBranch,
              baseBranch: params.baseBranch,
              baseRef: resolvedBaseRef,
            },
          });
        }
        await this.worktreeOps.addWorktree(
          params.repoPath,
          params.worktreePath,
          params.targetBranch,
        );
      } else {
        const resolvedBaseRef = await this.branchOps.resolveBaseRef(
          params.repoPath,
          params.baseBranch,
        );
        await this.worktreeOps.addWorktree(
          params.repoPath,
          params.worktreePath,
          params.targetBranch,
          { createBranch: true, baseRef: resolvedBaseRef },
        );
      }
      this.logger.log(
        `Provisioned git worktree for project=${params.scopeId} context=${params.contextId} at ${params.worktreePath}`,
      );
      await this.pushBranch(params.repoPath, params.targetBranch, {
        scopeId: params.scopeId,
        contextId: params.contextId,
      });
      return params.worktreePath;
    });
  }

  private async removeWorktreeWithinLock(
    params: RemoveWorktreeWithinLockParams,
  ): Promise<void> {
    await this.lockService.runRepoExclusive(params.repoPath, async () => {
      const existing = await this.worktreeOps.findWorktreeByPath(
        params.repoPath,
        params.worktreePath,
      );
      if (existing) {
        try {
          await this.worktreeOps.removeWorktree(
            params.repoPath,
            params.worktreePath,
          );
        } catch (error) {
          if (!isInvalidWorktreeGitdirError(error)) {
            throw error;
          }
          this.logger.warn(
            `Worktree registration exists but target git metadata is invalid for ${params.scopeId}/${params.contextId}; removing orphan directory directly: ${params.worktreePath}`,
          );
        }
      }
      await removeOrphanDirectory({
        logger: this.logger,
        scopeId: params.scopeId,
        contextId: params.contextId,
        worktreePath: params.worktreePath,
      });
      const branchToDelete = params.targetBranch?.trim() || existing?.branch;
      if (branchToDelete) {
        await deleteBranchBestEffort({
          gitCommand: this.gitCommand,
          logger: this.logger,
          repoPath: params.repoPath,
          branchName: branchToDelete,
          scopeId: params.scopeId,
          contextId: params.contextId,
        });
      }

      await pruneWorktreesBestEffort({
        worktreeOps: this.worktreeOps,
        logger: this.logger,
        repoPath: params.repoPath,
        scopeId: params.scopeId,
      });
    });
  }

  private async findManagedWorktreeUsingBranch(params: {
    repoPath: string;
    scopeId: string;
    targetBranch: string;
    requestedWorktreePath: string;
  }): Promise<GitWorktreeEntry | null> {
    const managedRoot = resolveManagedRoot(
      this.pathService.getWorktreeBasePath(),
      params.scopeId,
    );
    const worktrees = await this.worktreeOps.listWorktrees(params.repoPath);
    const normalizedRequested = params.requestedWorktreePath
      .replace(/\/+$/, '')
      .replace(/\\/g, '/');
    return (
      worktrees.find((entry) => {
        if (entry.branch !== params.targetBranch) return false;
        if (!this.pathService.isWithinRoot(entry.path, managedRoot))
          return false;
        const normalizedEntry = entry.path
          .replace(/\/+$/, '')
          .replace(/\\/g, '/');
        return normalizedEntry !== normalizedRequested;
      }) ?? null
    );
  }
}
