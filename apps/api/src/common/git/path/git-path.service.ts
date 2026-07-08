import { BadRequestException, Injectable } from '@nestjs/common';
import { access, constants as fsConstants } from 'node:fs/promises';
import * as path from 'node:path';

@Injectable()
export class GitPathService {
  getWorktreePath(scopeId: string, contextId: string): string {
    return path.join(this.getWorktreeBasePath(), scopeId, contextId);
  }

  getWorktreeBasePath(): string {
    const configured = process.env.NEXUS_WORKTREE_BASE_PATH?.trim();
    if (configured) {
      return path.resolve(configured);
    }

    const workspaceBase = process.env.NEXUS_WORKSPACE_BASE_PATH?.trim();
    if (workspaceBase) {
      return path.resolve(workspaceBase, 'worktrees');
    }

    return path.resolve(process.cwd(), 'data', 'worktrees');
  }

  /**
   * Base directory holding the orchestrator's persistent per-scope clones, or
   * `null` when no workspace base is configured (e.g. unit/dev environments
   * that never materialise clones).
   */
  getClonesBasePath(): string | null {
    const workspaceBase = process.env.NEXUS_WORKSPACE_BASE_PATH?.trim();
    if (!workspaceBase) {
      return null;
    }
    return path.resolve(workspaceBase, 'clones');
  }

  async resolveGitRepoPath(basePath: string | null): Promise<string> {
    const sanitizedBasePath = basePath?.trim();
    if (!sanitizedBasePath) {
      throw new BadRequestException('Project base path is not configured');
    }

    const candidate = path.resolve(sanitizedBasePath);

    const gitPath = path.resolve(candidate, '.git');
    try {
      await access(gitPath, fsConstants.F_OK);
      return candidate;
    } catch {
      throw new BadRequestException(
        `Project base path is not a git repository: ${candidate}`,
      );
    }
  }

  isWithinRoot(targetPath: string, rootPath: string): boolean {
    const relative = path.relative(
      path.resolve(rootPath),
      path.resolve(targetPath),
    );
    return (
      relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    );
  }
}
