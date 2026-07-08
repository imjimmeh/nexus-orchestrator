import * as path from 'node:path';
import { isErrorEnvelope } from '@nexus/core';

export function isInvalidWorktreeGitdirError(error: unknown): boolean {
  return isErrorEnvelope(error) && error.kind === 'worktree.gitdir-invalid';
}

export function resolveManagedRoot(basePath: string, scopeId: string): string {
  return path.join(basePath, scopeId);
}
