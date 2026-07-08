import { asRecord, readString } from '@nexus/core';

export { asRecord };

export function readStringField(
  record: Record<string, unknown> | undefined,
  fieldName: string,
): string | undefined {
  return readString(record?.[fieldName]);
}

/**
 * Read the absolute path of a per-run worktree recorded by a
 * `provision_worktree` step. Present only while the worktree is live; cleared
 * by `remove_worktree`.
 */
export function readProvisionedWorktreePath(
  stateVariables: Record<string, unknown>,
): string | undefined {
  const internal = asRecord(stateVariables._internal);
  return readStringField(internal, 'workspace_worktree_path');
}

/**
 * Resolve the clone-root workspace path for a scope when no worktree applies.
 * Throws only when a repository URL is known but the clone cannot be located.
 */
export async function resolveProjectBasePathFallback(
  gitWorktreeService: {
    resolveProjectBasePath(scopeId: string): Promise<string>;
  },
  scopeId: string | undefined,
  repositoryUrl: string | undefined,
): Promise<string | undefined> {
  if (!scopeId) {
    return undefined;
  }
  try {
    return await gitWorktreeService.resolveProjectBasePath(scopeId);
  } catch {
    if (repositoryUrl) {
      throw new Error(
        `Unable to resolve workspace mount path for workflow scope '${scopeId}'`,
      );
    }
    return undefined;
  }
}

export function resolveOutputText(output: Record<string, unknown>): string {
  if (typeof output.response === 'string') {
    return output.response;
  }

  if (typeof output.logsTail === 'string') {
    return output.logsTail;
  }

  return JSON.stringify(output);
}

export function truncateContextText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars) + '\n…[truncated]';
}

export function formatContextSections(
  scope: 'steps' | 'jobs',
  sections: string[],
): string {
  if (sections.length === 0) {
    return '';
  }

  return `## Context from previous ${scope}\n\n${sections.join('\n\n')}\n`;
}
