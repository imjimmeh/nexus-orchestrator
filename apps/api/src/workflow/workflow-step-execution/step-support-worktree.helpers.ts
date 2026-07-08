import { getScopeId } from '@nexus/core';
import { resolveTriggerContext } from '../../shared/agent-scope.utils';
import {
  asRecord,
  readProvisionedWorktreePath,
  readStringField,
  resolveProjectBasePathFallback,
} from './step-support-context.helpers';

const ORCHESTRATION_LIFECYCLE_CONTEXT_ID = '__orchestration_lifecycle__';

function shouldTryProjectScopedFallback(params: {
  scopeId?: string;
  contextId?: string;
  basePath?: string;
}): boolean {
  return Boolean(
    params.scopeId &&
    !params.basePath &&
    (!params.contextId ||
      params.contextId === ORCHESTRATION_LIFECYCLE_CONTEXT_ID),
  );
}

async function tryResolveExistingWorktreePath(
  scopeId: string,
  contextId: string | undefined,
  gitWorktreeService: {
    getExistingWorktreePath(
      scopeId: string,
      contextId: string,
    ): Promise<string | null>;
  },
): Promise<string | undefined> {
  if (!contextId) {
    return undefined;
  }

  try {
    return (
      (await gitWorktreeService.getExistingWorktreePath(scopeId, contextId)) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

export async function resolveWorktreePathFromTrigger(
  stateVariables: Record<string, unknown>,
  gitWorktreeService: {
    getExistingWorktreePath(
      scopeId: string,
      contextId: string,
    ): Promise<string | null>;
    resolveProjectBasePath(scopeId: string): Promise<string>;
  },
): Promise<string | undefined> {
  const provisionedWorktreePath = readProvisionedWorktreePath(stateVariables);
  if (provisionedWorktreePath) {
    return provisionedWorktreePath;
  }

  const context = resolveTriggerContext(stateVariables.trigger);
  const scopeId = getScopeId(context) ?? undefined;
  const trigger = asRecord(stateVariables.trigger);
  const contextId = context.contextId ?? undefined;
  const basePath = readStringField(trigger, 'basePath');
  const resolvedRepoPath =
    readStringField(trigger, 'resolvedRepoPath') ??
    readStringField(trigger, 'resolved_repo_path');
  const repositoryUrl =
    readStringField(trigger, 'repositoryUrl') ??
    readStringField(trigger, 'repository_url');
  const triggerRepoPath = basePath ?? resolvedRepoPath;

  if (!scopeId) {
    return triggerRepoPath ?? undefined;
  }

  const explicitWorktreePath = await tryResolveExistingWorktreePath(
    scopeId,
    contextId,
    gitWorktreeService,
  );
  if (explicitWorktreePath) {
    return explicitWorktreePath;
  }

  if (
    shouldTryProjectScopedFallback({
      scopeId,
      contextId,
      basePath: triggerRepoPath,
    })
  ) {
    const projectScopedPath = await tryResolveExistingWorktreePath(
      scopeId,
      scopeId,
      gitWorktreeService,
    );
    if (projectScopedPath) {
      return projectScopedPath;
    }
  }

  if (triggerRepoPath) {
    return triggerRepoPath;
  }

  return resolveProjectBasePathFallback(
    gitWorktreeService,
    scopeId,
    repositoryUrl,
  );
}
