import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function listSpecFilesFromGitDiff(params: {
  repoPath: string;
  specDirectory: string;
  baseBranch: string;
  targetBranch: string;
  warnings: string[];
  commitRange?: { baseMergeCommit?: string; mergeCommit?: string };
  onLog(message: string): void;
  onWarn(message: string): void;
}): Promise<string[] | null> {
  const normalizedSpecDirectory = params.specDirectory
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const specPrefix = `${normalizedSpecDirectory}/`;
  const failures: string[] = [];

  const shaResult = await tryCommitShaDiff({
    repoPath: params.repoPath,
    normalizedSpecDirectory,
    specPrefix,
    commitRange: params.commitRange,
    failures,
    onLog: (message) => {
      params.onLog(message);
    },
    onWarn: (message) => {
      params.onWarn(message);
    },
  });
  if (shaResult) {
    return shaResult;
  }

  const attemptedRanges = buildRevisionRanges(
    params.baseBranch,
    params.targetBranch,
  );

  for (const revisionRange of attemptedRanges) {
    try {
      const changedSpecs = await readChangedSpecFilesFromGit(
        params.repoPath,
        normalizedSpecDirectory,
        specPrefix,
        ['diff', '--name-only', '--diff-filter=AMR', revisionRange],
      );

      params.onLog(
        `hydrate: discovered ${changedSpecs.length} changed markdown spec file(s) via git diff ${revisionRange}`,
      );

      return changedSpecs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${revisionRange}: ${message}`);
    }
  }

  try {
    const changedSpecs = await readChangedSpecFilesFromGit(
      params.repoPath,
      normalizedSpecDirectory,
      specPrefix,
      ['diff', '--name-only', '--diff-filter=AMR', 'HEAD~1..HEAD'],
    );

    params.onLog(
      `hydrate: discovered ${changedSpecs.length} changed markdown spec file(s) via git diff HEAD~1..HEAD fallback`,
    );

    return changedSpecs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`HEAD~1..HEAD: ${message}`);

    params.warnings.push(
      `Failed to resolve changed spec files via git diff (${attemptedRanges.join(', ')}) and HEAD fallback: ${failures.join(' | ')}`,
    );
    params.onWarn(
      `hydrate: git diff discovery failed for ${params.baseBranch}/${params.targetBranch}: ${failures.join(' | ')}`,
    );
    return null;
  }
}

async function tryCommitShaDiff(params: {
  repoPath: string;
  normalizedSpecDirectory: string;
  specPrefix: string;
  commitRange: { baseMergeCommit?: string; mergeCommit?: string } | undefined;
  failures: string[];
  onLog(message: string): void;
  onWarn(message: string): void;
}): Promise<string[] | null> {
  const { baseMergeCommit, mergeCommit } = params.commitRange ?? {};
  if (!baseMergeCommit || !mergeCommit) {
    return null;
  }

  if (baseMergeCommit === mergeCommit) {
    params.onWarn(
      `hydrate: baseMergeCommit === mergeCommit (${baseMergeCommit.slice(0, 8)}), skipping SHA-based diff`,
    );
    return null;
  }

  const shaRange = `${baseMergeCommit}..${mergeCommit}`;
  try {
    const changedSpecs = await readChangedSpecFilesFromGit(
      params.repoPath,
      params.normalizedSpecDirectory,
      params.specPrefix,
      ['diff', '--name-only', '--diff-filter=AMR', shaRange],
    );

    params.onLog(
      `hydrate: discovered ${changedSpecs.length} changed markdown spec file(s) via git diff ${baseMergeCommit.slice(0, 8)}..${mergeCommit.slice(0, 8)}`,
    );

    return changedSpecs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.failures.push(
      `${baseMergeCommit.slice(0, 8)}..${mergeCommit.slice(0, 8)}: ${message}`,
    );
    return null;
  }
}

async function readChangedSpecFilesFromGit(
  repoPath: string,
  normalizedSpecDirectory: string,
  specPrefix: string,
  baseArgs: string[],
): Promise<string[]> {
  const { stdout } = await execFileAsync('git', [
    '-C',
    repoPath,
    ...baseArgs,
    '--',
    normalizedSpecDirectory,
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter((line) => line.length > 0)
    .filter((line) => line.startsWith(specPrefix))
    .filter((line) => line.toLowerCase().endsWith('.md'))
    .map((line) => line.slice(specPrefix.length))
    .sort((a, b) => a.localeCompare(b));
}

function buildRevisionRanges(
  baseBranch: string,
  targetBranch: string,
): string[] {
  const withOrigin = (ref: string): string =>
    ref.startsWith('origin/') ? ref : `origin/${ref}`;

  const variants = [
    `${baseBranch}...${targetBranch}`,
    `${withOrigin(baseBranch)}...${targetBranch}`,
    `${baseBranch}...${withOrigin(targetBranch)}`,
    `${withOrigin(baseBranch)}...${withOrigin(targetBranch)}`,
  ];

  return Array.from(new Set(variants));
}
