import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import { GitCommandService } from './git-command/git-command.service';
import { RepositoryLockService } from './locking/repository-lock.service';
import { BranchOperationsService } from './branch/branch-operations.service';
import type {
  CommitPathsParams,
  CommitPathsResult,
} from './git-commit-paths.service.types';

const NEXUS_COMMIT_USER_NAME = 'Nexus Orchestrator';
const NEXUS_COMMIT_USER_EMAIL = 'nexus@localhost';

@Injectable()
export class GitCommitPathsService {
  private readonly logger = new Logger(GitCommitPathsService.name);

  constructor(
    private readonly gitCommand: GitCommandService,
    private readonly lockService: RepositoryLockService,
    private readonly branchOps: BranchOperationsService,
  ) {}

  async commitPaths(params: CommitPathsParams): Promise<CommitPathsResult> {
    const paths = this.normalizePathspecs(params.paths);
    const message = params.message.trim();
    if (!message) {
      throw new BadRequestException('Commit message is required');
    }

    return this.lockService.runRepoExclusive(params.repoPath, async () => {
      const status = await this.gitCommand.exec(params.repoPath, [
        'status',
        '--porcelain',
        '--',
        ...paths,
      ]);
      if (!status.stdout.trim()) {
        return this.cleanResult();
      }

      await this.ensureCommitIdentity(params.repoPath);

      await this.gitCommand.exec(params.repoPath, [
        'add',
        '-A',
        '--',
        ...paths,
      ]);

      const staged = await this.gitCommand.exec(params.repoPath, [
        'diff',
        '--cached',
        '--name-only',
        '--',
        ...paths,
      ]);
      const changedFiles = this.parseChangedFiles(staged.stdout);
      if (changedFiles.length === 0) {
        return this.cleanResult();
      }

      await this.gitCommand.exec(params.repoPath, [
        'commit',
        '-m',
        message,
        '--',
        ...paths,
      ]);
      const head = await this.gitCommand.exec(params.repoPath, [
        'rev-parse',
        'HEAD',
      ]);

      if (params.push) {
        try {
          const currentBranchResult = await this.gitCommand.exec(
            params.repoPath,
            ['symbolic-ref', '--short', 'HEAD'],
          );
          const currentBranch = currentBranchResult.stdout.trim();
          if (currentBranch) {
            const hasRemote = await this.branchOps.hasOriginRemote(
              params.repoPath,
            );
            if (hasRemote) {
              await this.branchOps.pushBranch(params.repoPath, currentBranch);
            }
          }
        } catch (pushError) {
          this.logger.warn(
            `Failed to push branch after commit: ${
              pushError instanceof Error ? pushError.message : String(pushError)
            }`,
          );
        }
      }

      return {
        committed: true,
        status: 'committed',
        changed_files: changedFiles,
        commit_sha: head.stdout.trim(),
      };
    });
  }

  private async ensureCommitIdentity(repoPath: string): Promise<void> {
    await this.gitCommand.exec(repoPath, [
      'config',
      '--local',
      'user.name',
      NEXUS_COMMIT_USER_NAME,
    ]);
    await this.gitCommand.exec(repoPath, [
      'config',
      '--local',
      'user.email',
      NEXUS_COMMIT_USER_EMAIL,
    ]);
  }

  private cleanResult(): CommitPathsResult {
    return {
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    };
  }

  private normalizePathspecs(rawPaths: string[]): string[] {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
      throw new BadRequestException('At least one commit path is required');
    }

    return rawPaths.map((rawPath) => {
      if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
        throw new BadRequestException('Commit paths must be non-empty strings');
      }

      const trimmed = rawPath.trim();
      const posixPath = trimmed.replace(/\\/g, '/');

      if (posixPath.startsWith(':') || posixPath.startsWith('!')) {
        throw new BadRequestException(`Unsafe commit path: ${rawPath}`);
      }

      if (/[?*[\]]/u.test(posixPath)) {
        throw new BadRequestException(`Unsafe commit path: ${rawPath}`);
      }

      const beforeNormalize = posixPath.split('/');
      for (const segment of beforeNormalize) {
        if (segment === '..') {
          throw new BadRequestException(`Unsafe commit path: ${rawPath}`);
        }
      }

      const normalized = path.posix.normalize(posixPath);
      if (normalized === '.' || normalized === '..') {
        throw new BadRequestException(`Unsafe commit path: ${rawPath}`);
      }

      if (
        normalized.startsWith('../') ||
        path.isAbsolute(normalized) ||
        /^[A-Za-z]:\//u.test(normalized)
      ) {
        throw new BadRequestException(`Unsafe commit path: ${rawPath}`);
      }

      return normalized;
    });
  }

  private parseChangedFiles(stdout: string): string[] {
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
