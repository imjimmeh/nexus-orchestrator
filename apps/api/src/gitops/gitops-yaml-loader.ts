import { stat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GITOPS_LAYOUT, type DesiredStateFile } from '@nexus/gitops-contracts';
import type { GitOpsLoadYamlTreeOptions } from './config-validation.service.types';

function toPosixRelative(baseDir: string, fullPath: string): string {
  return path.relative(baseDir, fullPath).split(path.sep).join('/');
}

function normalizePathPrefix(pathPrefix?: string): string | undefined {
  if (!pathPrefix) {
    return undefined;
  }

  const normalized = path.posix
    .normalize(pathPrefix.split(path.sep).join('/'))
    .replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 && normalized !== '.' ? normalized : undefined;
}

function isGitOpsDocFilename(fileName: string): boolean {
  return /^[^./]+\.ya?ml$/i.test(fileName);
}

function composeLayoutPath(relativePath: string, pathPrefix?: string): string {
  if (!pathPrefix) {
    return relativePath;
  }

  if (
    relativePath === pathPrefix ||
    relativePath.startsWith(`${pathPrefix}/`)
  ) {
    return relativePath;
  }

  return `${pathPrefix}/${relativePath}`;
}

function isDesiredStatePath(
  relativePath: string,
  pathPrefix?: string,
): boolean {
  const emittedPath = composeLayoutPath(relativePath, pathPrefix);

  if (emittedPath === GITOPS_LAYOUT.manifest) {
    return true;
  }

  if (emittedPath === GITOPS_LAYOUT.assignmentsFile) {
    return true;
  }

  if (emittedPath.startsWith(`${GITOPS_LAYOUT.rolesDir}/`)) {
    return isGitOpsDocFilename(path.posix.basename(emittedPath));
  }

  if (
    emittedPath.startsWith(`${GITOPS_LAYOUT.agentsDir}/`) ||
    emittedPath.startsWith(`${GITOPS_LAYOUT.workflowsDir}/`) ||
    emittedPath.startsWith(`${GITOPS_LAYOUT.skillsDir}/`)
  ) {
    return isGitOpsDocFilename(path.posix.basename(emittedPath));
  }

  if (!emittedPath.startsWith(`${GITOPS_LAYOUT.scopesDir}/`)) {
    return false;
  }

  const segments = emittedPath.split('/');
  if (segments.at(-1) === GITOPS_LAYOUT.scopeFile) {
    return true;
  }

  const docDir = segments.at(-2);
  const docName = segments.at(-1);
  if (!docName) {
    return false;
  }
  return (
    (docDir === GITOPS_LAYOUT.agentsDir ||
      docDir === GITOPS_LAYOUT.workflowsDir ||
      docDir === GITOPS_LAYOUT.skillsDir) &&
    isGitOpsDocFilename(docName)
  );
}

async function collectDesiredStateFiles(
  currentDir: string,
  baseDir: string,
  files: DesiredStateFile[],
  pathPrefix?: string,
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectDesiredStateFiles(fullPath, baseDir, files, pathPrefix);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = toPosixRelative(baseDir, fullPath);
    if (!isDesiredStatePath(relativePath, pathPrefix)) {
      continue;
    }

    const content = parseYaml(await readFile(fullPath, 'utf8')) as Record<
      string,
      unknown
    >;
    files.push({ path: composeLayoutPath(relativePath, pathPrefix), content });
  }
}

export async function loadYamlTreeFromDir(
  dir: string,
  options?: GitOpsLoadYamlTreeOptions,
): Promise<DesiredStateFile[]> {
  const files: DesiredStateFile[] = [];
  const pathPrefix = normalizePathPrefix(options?.pathPrefix);
  const stats = await stat(dir).catch(() => null);
  if (!stats?.isDirectory()) {
    return files;
  }

  await collectDesiredStateFiles(dir, dir, files, pathPrefix);
  return files;
}
