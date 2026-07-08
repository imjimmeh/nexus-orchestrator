import { access, constants as fsConstants } from 'node:fs/promises';
import * as path from 'node:path';

const UUID_SCOPE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function buildGitRepositoryPathCandidates(scopeId: string): string[] {
  const candidates = new Set<string>([scopeId]);
  if (!UUID_SCOPE_ID_PATTERN.test(scopeId)) {
    return [...candidates];
  }

  const workspaceBaseCandidates = [
    process.env.NEXUS_WORKSPACE_BASE_PATH?.trim(),
    path.posix.join('/data', 'nexus-workspaces'),
    path.posix.join('/tmp', 'nexus-workspaces'),
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0,
  );

  for (const workspaceBase of workspaceBaseCandidates) {
    const pathModule = shouldUseWindowsPath(workspaceBase)
      ? path.win32
      : path.posix;
    candidates.add(pathModule.join(workspaceBase, 'clones', scopeId));
  }

  return [...candidates];
}

function shouldUseWindowsPath(basePath: string): boolean {
  return /^[a-z]:/iu.test(basePath) || basePath.includes('\\');
}

export async function resolveGitRepositoryPath(
  basePath: string | null,
): Promise<string | null> {
  if (!basePath) {
    return null;
  }
  for (const candidatePath of buildGitRepositoryPathCandidates(basePath)) {
    const candidate = path.resolve(candidatePath);
    const gitPath = path.resolve(candidate, '.git');
    try {
      await access(gitPath, fsConstants.F_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
