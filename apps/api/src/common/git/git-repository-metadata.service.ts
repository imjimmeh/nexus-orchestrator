import { BadRequestException, Injectable } from '@nestjs/common';
import type { RepositoryFileContent } from '@nexus/core';
import { GitCommandService } from './git-command/git-command.service';
import type { ReadFileAtRefParams } from './git-repository-metadata.service.types';

@Injectable()
export class GitRepositoryMetadataService {
  constructor(private readonly gitCommand: GitCommandService) {}

  async listBranches(repoPath: string): Promise<string[]> {
    const [localBranches, remoteBranches] = await Promise.all([
      this.gitCommand.execLines(repoPath, [
        'branch',
        '--format=%(refname:short)',
      ]),
      this.gitCommand.execLines(repoPath, [
        'branch',
        '-r',
        '--format=%(refname:short)',
      ]),
    ]);

    return Array.from(
      new Set([
        ...localBranches.map((branch) => this.normalizeBranch(branch)),
        ...remoteBranches.map((branch) => this.normalizeRemoteBranch(branch)),
      ]),
    )
      .filter((branch) => branch.length > 0)
      .sort((first, second) => first.localeCompare(second));
  }

  async listTrackedFiles(repoPath: string): Promise<string[]> {
    const files = await this.gitCommand.execLines(repoPath, ['ls-files']);
    return files
      .map((file) => this.normalizeFilePath(file))
      .sort((first, second) => first.localeCompare(second));
  }

  async readFileAtRef(
    params: ReadFileAtRefParams,
  ): Promise<RepositoryFileContent> {
    const filePath = this.requireSafeFilePath(params.filePath);
    const branch = params.ref?.trim() || 'HEAD';
    const { stdout } = await this.gitCommand.exec(params.repoPath, [
      'show',
      `${branch}:${filePath}`,
    ]);

    return {
      content: stdout,
      path: filePath,
      branch,
      size: Buffer.byteLength(stdout, 'utf8'),
    };
  }

  private normalizeBranch(branch: string): string {
    return branch.trim();
  }

  private normalizeRemoteBranch(branch: string): string {
    const normalized = this.normalizeBranch(branch);
    if (normalized.includes('HEAD') || normalized.includes('->')) {
      return '';
    }
    return normalized.replace(/^[^/]+\//, '');
  }

  private normalizeFilePath(filePath: string): string {
    return filePath.trim().replace(/\\/g, '/');
  }

  private requireSafeFilePath(filePath: string): string {
    const normalized = this.normalizeFilePath(filePath);
    const segments = normalized.split('/');
    if (
      !normalized ||
      normalized.startsWith('/') ||
      normalized.startsWith('\\') ||
      /^[A-Za-z]:[\\/]/.test(normalized) ||
      segments.includes('..')
    ) {
      throw new BadRequestException(
        'filePath must be a repository-relative path',
      );
    }
    return normalized;
  }
}
