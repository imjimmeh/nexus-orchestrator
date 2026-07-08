export { asRecord } from '@nexus/core';
import { readString } from '@nexus/core';

export function getString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return readString(record?.[key]);
}

export function requireWorktreeId(
  stepId: string,
  action: string,
  context: { worktreeId?: string },
): string {
  if (context.worktreeId) {
    return context.worktreeId;
  }
  throw new Error(
    `Step ${stepId}: git_operation ${action} requires inputs.worktree_id or trigger.git.worktree_id`,
  );
}

export function isWorktreePathForId(
  pathValue: string,
  worktreeId: string,
): boolean {
  const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').at(-1) === worktreeId;
}

/** First non-empty trimmed string among the primary value and fallbacks. */
export function resolveBranchValue(
  primary: unknown,
  ...fallbacks: Array<string | undefined>
): string | undefined {
  if (typeof primary === 'string' && primary.trim().length > 0) {
    return primary.trim();
  }
  for (const fallback of fallbacks) {
    if (typeof fallback === 'string' && fallback.trim().length > 0) {
      return fallback.trim();
    }
  }
  return undefined;
}

export function isNonEmptyStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

interface CommitRepoPathResolver {
  resolveProjectBasePath(repositoryId: string): Promise<string>;
  getExistingWorktreePath(
    scopeId: string,
    contextId: string,
  ): Promise<string | null>;
}

interface MergeWorktreeResolver {
  getExistingWorktreePath(
    scopeId: string,
    contextId: string,
  ): Promise<string | null>;
  provisionWorktree(
    scopeId: string,
    contextId: string,
    baseBranch: string,
    targetBranch: string,
  ): Promise<string>;
}

/**
 * Resolve the worktree the `merge` operation runs in. The merge happens inside
 * the context's own worktree (so a conflict-resolution agent operating in that
 * same worktree sees real markers); it is provisioned on demand when absent.
 */
export async function resolveMergeWorktreePath(
  service: MergeWorktreeResolver,
  repositoryId: string,
  worktreeId: string,
  baseBranch: string,
  targetBranch: string,
): Promise<string> {
  return (
    (await service.getExistingWorktreePath(repositoryId, worktreeId)) ??
    (await service.provisionWorktree(
      repositoryId,
      worktreeId,
      baseBranch,
      targetBranch,
    ))
  );
}

/**
 * Resolve where a `commit_paths` operation should run. Prefers the work item's
 * provisioned worktree (so artifacts land on a feature branch) and falls back
 * to the clone root only when no worktree is in context.
 */
export async function resolveCommitRepoPath(
  service: CommitRepoPathResolver,
  stepId: string,
  triggerContext: { repositoryId: string; worktreeId?: string },
): Promise<string> {
  if (!triggerContext.worktreeId) {
    return service.resolveProjectBasePath(triggerContext.repositoryId);
  }

  const worktreePath = await service.getExistingWorktreePath(
    triggerContext.repositoryId,
    triggerContext.worktreeId,
  );
  if (!worktreePath) {
    throw new Error(
      `Step ${stepId}: git_operation commit_paths specified worktree_id ${triggerContext.worktreeId} but no provisioned worktree was found for repository ${triggerContext.repositoryId}`,
    );
  }
  return worktreePath;
}
