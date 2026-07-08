import * as path from 'node:path';
import type { MergeResult } from './git-merge.service.types';
import type {
  PorcelainEntry,
  SharedCloneBlockerClassification,
  SharedCloneReconcileRunner,
} from './git-shared-clone-reconcile.types';

export type {
  PorcelainEntry,
  SharedCloneBlockerClassification,
  SharedCloneReconcileRunner,
} from './git-shared-clone-reconcile.types';

const RESTORABLE_STATUSES = new Set([' D', 'D ']);
const UNTRACKED_STATUS = '??';

/** Parse `git status --porcelain=v1 -z` output into status/path entries. */
export function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  return stdout
    .split('\0')
    .filter((record) => record.length >= 4)
    .flatMap((record) => {
      const status = record.slice(0, 2);
      const rawPath = record.slice(3).trim();
      const path = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').at(-1)?.trim()
        : rawPath;
      return path ? [{ status, path }] : [];
    });
}

/**
 * Partition integration blockers into deterministically-safe actions.
 * The union of the three buckets equals the preflight blocker set:
 * every non-untracked entry plus untracked entries tracked on the source branch.
 */
export function classifySharedCloneBlockers(
  entries: PorcelainEntry[],
  sourceTrackedPaths: Set<string>,
): SharedCloneBlockerClassification {
  const classification: SharedCloneBlockerClassification = {
    restorable: [],
    quarantinable: [],
    ambiguous: [],
  };
  for (const { status, path } of entries) {
    if (status === UNTRACKED_STATUS) {
      if (sourceTrackedPaths.has(path)) {
        classification.quarantinable.push(path);
      }
      continue;
    }
    if (RESTORABLE_STATUSES.has(status)) {
      classification.restorable.push(path);
      continue;
    }
    classification.ambiguous.push(path);
  }
  return classification;
}

const QUARANTINE_DIR_NAME = 'reconcile-quarantine';

/** Quarantine root lives beside `clones/` on the same workspace mount. */
export function resolveQuarantineRoot(
  cloneRoot: string,
  scopeId: string,
  stamp: string,
): string {
  return path.resolve(
    cloneRoot,
    '..',
    '..',
    QUARANTINE_DIR_NAME,
    scopeId,
    stamp,
  );
}

/**
 * Deterministically reconcile the provably-safe shared-clone blockers before
 * falling back to agent remediation: restore tracked deletions from HEAD and
 * quarantine untracked files the source branch already tracks. Runs a single
 * `status` scan and treats the remaining `ambiguous` bucket as still-dirty —
 * a second scan would only pretend to guard against a TOCTOU race that a
 * shared, concurrently-mutated clone can't actually avoid.
 */
export async function reconcileSharedCloneBlockers(
  runner: SharedCloneReconcileRunner,
  cloneRoot: string,
  scopeId: string,
  sourceBranch: string,
  destinationBranch: string,
  sourceTrackedPaths: Set<string>,
  authEnv: Record<string, string>,
): Promise<MergeResult> {
  const { stdout } = await runner.runGitCapture(
    cloneRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    authEnv,
  );
  const classification = classifySharedCloneBlockers(
    parsePorcelainEntries(stdout),
    sourceTrackedPaths,
  );

  for (const restorePath of classification.restorable) {
    await runner.runGit(
      cloneRoot,
      ['checkout', 'HEAD', '--', restorePath],
      authEnv,
    );
  }

  const quarantineRoot = resolveQuarantineRoot(
    cloneRoot,
    scopeId,
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  for (const strayPath of classification.quarantinable) {
    await runner.moveFileWithDirs(
      path.join(cloneRoot, strayPath),
      path.join(quarantineRoot, strayPath),
    );
  }

  const remaining = classification.ambiguous;
  const reconciledSummary =
    `restored ${classification.restorable.length} deleted tracked file(s), ` +
    `quarantined ${classification.quarantinable.length} blocking untracked file(s)` +
    (classification.quarantinable.length > 0 ? ` under ${quarantineRoot}` : '');

  if (remaining.length === 0) {
    return {
      outcome: 'succeeded',
      sourceBranch,
      destinationBranch,
      conflictedFiles: [],
      dirtyPaths: [],
      sharedClonePath: cloneRoot,
      restoredPaths: classification.restorable,
      quarantinedPaths: classification.quarantinable,
      message: `Shared clone reconciled deterministically: ${reconciledSummary}`,
    };
  }
  return {
    outcome: 'shared_clone_dirty',
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    dirtyPaths: remaining,
    sharedClonePath: cloneRoot,
    restoredPaths: classification.restorable,
    quarantinedPaths: classification.quarantinable,
    message:
      `Deterministic reconciliation done (${reconciledSummary}) but ambiguous paths remain: ` +
      remaining.join(', '),
  };
}
