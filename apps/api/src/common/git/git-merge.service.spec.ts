import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitMergeService } from './git-merge.service';

/**
 * The merge runs the base→feature merge inside the per-context worktree (so a
 * conflict-resolution agent operating in that same worktree sees real conflict
 * markers), then integrates the resolved feature into the base inside the shared
 * clone root. These tests pin that contract by stubbing the two git seams:
 *  - `runGit`        — mutating commands (throws on failure)
 *  - `runGitCapture` — read/conditional commands (returns an exit code)
 */
describe('GitMergeService', () => {
  const eventLedger = {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };
  const authEnvResolver = {
    resolveProjectGitAuthEnv: vi.fn().mockResolvedValue({}),
  };

  const CLONE_ROOT = '/clones/scope-1';
  const WORKTREE = '/worktrees/scope-1/ctx-1';
  const SOURCE = 'feature/ctx-1';
  const BASE = 'main';

  let service: GitMergeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitMergeService(eventLedger as never, authEnvResolver);
    vi.spyOn(service, 'resolveGitRepoPath').mockResolvedValue(CLONE_ROOT);
  });

  type Capture = { code: number; stdout: string; stderr: string };

  /** Build a `runGitCapture` stub from a predicate→capture map keyed on argv. */
  function stubCapture(handler: (repoPath: string, args: string[]) => Capture) {
    return vi
      .spyOn(service, 'runGitCapture')
      .mockImplementation(async (repoPath: string, args: string[]) =>
        handler(repoPath, args),
      );
  }

  const ok: Capture = { code: 0, stdout: '', stderr: '' };
  const fail: Capture = { code: 1, stdout: '', stderr: '' };

  it('returns conflict WITHOUT aborting when the base→feature merge conflicts in the worktree', async () => {
    // No in-progress merge; feature does not yet contain base; merge conflicts.
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
      if (args[0] === 'merge-base') return fail; // base not yet an ancestor
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok; // origin ref exists
      if (args[0] === 'diff')
        return { code: 0, stdout: 'src/a.ts\n', stderr: '' };
      return ok;
    });
    const runGit = vi
      .spyOn(service, 'runGit')
      .mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'merge' && args.includes('--no-ff')) {
          throw Object.assign(new Error('merge failed'), {
            stderr: 'CONFLICT (content): Merge conflict in src/a.ts',
          });
        }
      });

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result).toMatchObject({
      outcome: 'conflict',
      conflictedFiles: ['src/a.ts'],
    });
    // The conflict state MUST be preserved for the resolution agent.
    expect(runGit).not.toHaveBeenCalledWith(
      WORKTREE,
      ['merge', '--abort'],
      expect.anything(),
    );
    expect(runGit).not.toHaveBeenCalledWith(WORKTREE, ['merge', '--abort']);
  });

  it('discards uncommitted scratch in the worktree before merging the base', async () => {
    let head = 'feat-sha';
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
      if (args[0] === 'status' && args.includes('--porcelain'))
        return {
          code: 0,
          stdout: ' M apps/api/src/x.ts\n?? apps/api/y.json\n',
          stderr: '',
        };
      if (args[0] === 'merge-base') return ok; // feature already contains base
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'rev-parse' && args.includes('HEAD'))
        return { code: 0, stdout: `${head}\n`, stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return ok;
    });
    const runGit = vi
      .spyOn(service, 'runGit')
      .mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'merge' && args.includes('--no-ff')) head = 'merge-sha';
      });

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('succeeded');
    // The contaminated working tree is reset and cleaned IN THE WORKTREE before
    // the base is merged in, so scratch can never block `git merge <base>`.
    expect(runGit).toHaveBeenCalledWith(
      WORKTREE,
      ['reset', '--hard', 'HEAD'],
      expect.anything(),
    );
    expect(runGit).toHaveBeenCalledWith(
      WORKTREE,
      ['clean', '-fd'],
      expect.anything(),
    );
    // What was discarded is recorded for auditability.
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'git.merge.worktree_cleaned',
        payload: expect.objectContaining({
          worktreePath: WORKTREE,
          discardedPaths: ['M apps/api/src/x.ts', '?? apps/api/y.json'],
        }),
      }),
    );
  });

  it('does not reset or clean a worktree that has no uncommitted scratch', async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail;
      if (args[0] === 'status' && args.includes('--porcelain')) return ok; // clean
      if (args[0] === 'merge-base') return ok; // feature already contains base
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'rev-parse' && args.includes('HEAD'))
        return { code: 0, stdout: 'sha\n', stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return ok;
    });
    const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('succeeded');
    expect(runGit).not.toHaveBeenCalledWith(
      WORKTREE,
      ['reset', '--hard', 'HEAD'],
      expect.anything(),
    );
    expect(runGit).not.toHaveBeenCalledWith(
      WORKTREE,
      ['clean', '-fd'],
      expect.anything(),
    );
  });

  it('never discards scratch when a merge is already in progress (preserves resolution work)', async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return ok; // in progress
      if (args[0] === 'diff')
        return { code: 0, stdout: 'src/a.ts\n', stderr: '' }; // unresolved conflict
      return ok;
    });
    const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('conflict');
    expect(runGit).not.toHaveBeenCalledWith(
      WORKTREE,
      ['reset', '--hard', 'HEAD'],
      expect.anything(),
    );
    expect(runGit).not.toHaveBeenCalledWith(
      WORKTREE,
      ['clean', '-fd'],
      expect.anything(),
    );
  });

  it('classifies "local changes would be overwritten" as a failed merge with a clear message', async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail;
      if (args[0] === 'merge-base') return fail;
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' }; // no unmerged paths
      return ok;
    });
    vi.spyOn(service, 'runGit').mockImplementation(
      async (_repoPath: string, args: string[]) => {
        if (args[0] === 'merge' && args.includes('--no-ff')) {
          throw Object.assign(new Error('merge failed'), {
            stderr:
              'error: Your local changes to the following files would be overwritten by merge:\n\tdocs/x.md\nAborting',
          });
        }
      },
    );

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('failed');
    expect(result.message).toMatch(/uncommitted local changes/i);
  });

  it('integrates into a clean current base (reset to origin) and pushes when the worktree already contains base', async () => {
    let head = 'feat-sha';
    const runGitCapture = stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
      if (args[0] === 'merge-base') return ok; // feature already contains base
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'rev-parse' && args.includes('HEAD'))
        return { code: 0, stdout: `${head}\n`, stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return ok;
    });
    const runGit = vi
      .spyOn(service, 'runGit')
      .mockImplementation(async (_repoPath: string, args: string[]) => {
        if (args[0] === 'merge' && args.includes('--no-ff')) head = 'merge-sha';
      });

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('succeeded');
    // Base is reset to origin in the CLONE ROOT before integrating (kills stale
    // local main + a dirty working tree).
    expect(runGit).toHaveBeenCalledWith(
      CLONE_ROOT,
      ['reset', '--hard', `origin/${BASE}`],
      expect.anything(),
    );
    // The integration push now goes through runGitCapture (to capture hook output).
    expect(runGitCapture).toHaveBeenCalledWith(
      CLONE_ROOT,
      expect.arrayContaining(['push']),
      expect.anything(),
    );
  });

  it('disables local git hooks on the integration push', async () => {
    let head = 'feat-sha';
    const runGitCapture = stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
      if (args[0] === 'merge-base') return ok; // feature already contains base
      if (args.includes('push')) return ok; // push succeeds
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'rev-parse' && args.includes('HEAD'))
        return { code: 0, stdout: `${head}\n`, stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return ok;
    });
    vi.spyOn(service, 'runGit').mockImplementation(
      async (_repoPath: string, args: string[]) => {
        if (args[0] === 'merge' && args.includes('--no-ff')) head = 'merge-sha';
      },
    );

    await service.mergeWithConflictDetection('scope-1', SOURCE, BASE, WORKTREE);

    const pushCall = runGitCapture.mock.calls.find(([, args]) =>
      args.includes('push'),
    );
    expect(pushCall).toBeDefined();
    const pushArgs = pushCall?.[1] as string[];
    // Hooks are suppressed so the gate runs in-container, not via .husky/pre-push.
    expect(pushArgs).toEqual(
      expect.arrayContaining(['-c', 'core.hooksPath=/dev/null']),
    );
    expect(pushArgs).toEqual(
      expect.arrayContaining(['push', '--set-upstream', 'origin']),
    );
  });

  it('commits a staged-but-uncommitted in-progress merge in the worktree, then integrates', async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return ok; // in progress
      if (args[0] === 'merge-base') return ok;
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args[0] === 'rev-parse' && args.includes('HEAD'))
        return { code: 0, stdout: 'sha\n', stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' }; // resolution staged, no unmerged
      return ok;
    });
    const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('succeeded');
    expect(runGit).toHaveBeenCalledWith(
      WORKTREE,
      ['commit', '--no-edit'],
      expect.anything(),
    );
  });

  describe('prepareMergeInWorktree (stage 1 only)', () => {
    it('returns conflict and never pushes when the worktree merge conflicts', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
        if (args[0] === 'merge-base') return fail; // base not yet an ancestor
        if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`))
          return ok;
        if (args[0] === 'diff')
          return { code: 0, stdout: 'src/a.ts\n', stderr: '' };
        return ok;
      });
      const runGit = vi
        .spyOn(service, 'runGit')
        .mockImplementation(async (_repoPath: string, args: string[]) => {
          if (args[0] === 'merge' && args.includes('--no-ff')) {
            throw Object.assign(new Error('merge failed'), {
              stderr: 'CONFLICT (content): Merge conflict in src/a.ts',
            });
          }
        });

      const result = await service.prepareMergeInWorktree(
        'scope-1',
        SOURCE,
        BASE,
        WORKTREE,
      );

      expect(result).toMatchObject({
        outcome: 'conflict',
        conflictedFiles: ['src/a.ts'],
      });
      // Stage 1 never integrates or pushes.
      expect(runGit).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['push']),
        expect.anything(),
      );
    });

    it('returns a succeeded worktree-prepared result when the merge is clean (no push, no clone root)', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail;
        if (args[0] === 'merge-base') return ok; // feature already contains base
        if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`))
          return ok;
        if (args[0] === 'status' && args.includes('--porcelain')) return ok;
        if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
        return ok;
      });
      const resolveSpy = vi.spyOn(service, 'resolveGitRepoPath');
      vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

      const result = await service.prepareMergeInWorktree(
        'scope-1',
        SOURCE,
        BASE,
        WORKTREE,
      );

      expect(result.outcome).toBe('succeeded');
      expect(result.message).toMatch(/worktree/i);
      // Stage 1 must not resolve the clone root nor push.
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });

  describe('integrateAndPush (stage 2 only)', () => {
    it('preflights shared-clone files that would block source branch integration without cleaning them', async () => {
      const runGitCapture = stubCapture((repoPath, args) => {
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout: '?? docs/resources/child 1.md\0 M src/local file.ts\0',
            stderr: '',
          };
        }
        if (args[0] === 'ls-tree') {
          return {
            code: 0,
            stdout: 'docs/resources/child 1.md\0src/feature.ts\0',
            stderr: '',
          };
        }
        return ok;
      });
      const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

      const result = await service.preflightSharedCloneIntegration(
        'scope-1',
        SOURCE,
        BASE,
      );

      expect(result).toMatchObject({
        outcome: 'shared_clone_dirty',
        dirtyPaths: ['docs/resources/child 1.md', 'src/local file.ts'],
      });
      expect(result.message).toContain('docs/resources/child 1.md');
      expect(runGitCapture).toHaveBeenCalledWith(
        CLONE_ROOT,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        expect.anything(),
      );
      expect(runGitCapture).toHaveBeenCalledWith(
        CLONE_ROOT,
        ['ls-tree', '-z', '-r', '--name-only', SOURCE],
        expect.anything(),
      );
      expect(runGit).not.toHaveBeenCalledWith(
        CLONE_ROOT,
        ['clean', '-fd'],
        expect.anything(),
      );
    });

    it('preflights a clean shared clone as safe to integrate', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'status') return ok;
        if (args[0] === 'ls-tree') {
          return { code: 0, stdout: 'src/feature.ts\0', stderr: '' };
        }
        return ok;
      });

      const result = await service.preflightSharedCloneIntegration(
        'scope-1',
        SOURCE,
        BASE,
      );

      expect(result).toMatchObject({
        outcome: 'succeeded',
        dirtyPaths: [],
      });
      expect(result.message).toMatch(/clean/i);
    });

    it('resolves the clone root and performs the hook-free integration push', async () => {
      let head = 'feat-sha';
      const runGitCapture = stubCapture((repoPath, args) => {
        if (args.includes('push')) return ok;
        if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`))
          return ok;
        if (args[0] === 'rev-parse' && args.includes('HEAD'))
          return { code: 0, stdout: `${head}\n`, stderr: '' };
        return ok;
      });
      vi.spyOn(service, 'runGit').mockImplementation(
        async (_repoPath: string, args: string[]) => {
          if (args[0] === 'merge' && args.includes('--no-ff'))
            head = 'merge-sha';
        },
      );

      const result = await service.integrateAndPush('scope-1', SOURCE, BASE);

      expect(result.outcome).toBe('succeeded');
      const pushCall = runGitCapture.mock.calls.find(([, args]) =>
        args.includes('push'),
      );
      expect(pushCall?.[0]).toBe(CLONE_ROOT);
      expect(pushCall?.[1]).toEqual(
        expect.arrayContaining(['-c', 'core.hooksPath=/dev/null']),
      );
    });

    it('returns failed when the clone root cannot be resolved', async () => {
      vi.spyOn(service, 'resolveGitRepoPath').mockResolvedValue(null);
      const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

      const result = await service.integrateAndPush('scope-1', SOURCE, BASE);

      expect(result.outcome).toBe('failed');
      expect(runGit).not.toHaveBeenCalled();
    });
  });

  describe('reconcileSharedCloneIntegration', () => {
    it('restores tracked deletions and quarantines untracked source-tracked files, then reports success', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'status') {
          return {
            code: 0,
            stdout:
              ' D .agents/skills/debugging/SKILL.md\0?? docs/resources/child-1.md\0',
            stderr: '',
          };
        }
        if (args[0] === 'ls-tree') {
          return {
            code: 0,
            stdout:
              '.agents/skills/debugging/SKILL.md\0docs/resources/child-1.md\0',
            stderr: '',
          };
        }
        return ok;
      });
      const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);
      const moves: Array<{ from: string; to: string }> = [];
      vi.spyOn(service, 'moveFileWithDirs').mockImplementation(
        async (from: string, to: string) => {
          moves.push({ from, to });
        },
      );

      const result = await service.reconcileSharedCloneIntegration(
        'scope-1',
        SOURCE,
        BASE,
      );

      expect(result.outcome).toBe('succeeded');
      expect(result.restoredPaths).toEqual([
        '.agents/skills/debugging/SKILL.md',
      ]);
      expect(result.quarantinedPaths).toEqual(['docs/resources/child-1.md']);
      expect(result.sharedClonePath).toBe(CLONE_ROOT);
      expect(runGit).toHaveBeenCalledWith(
        CLONE_ROOT,
        ['checkout', 'HEAD', '--', '.agents/skills/debugging/SKILL.md'],
        expect.anything(),
      );
      expect(moves).toHaveLength(1);
      // Normalize separators: path.join uses the native separator (`\` on Windows).
      const [movedFrom, movedTo] = [moves[0].from, moves[0].to].map((p) =>
        p.replace(/\\/g, '/'),
      );
      expect(movedFrom).toContain('docs/resources/child-1.md');
      expect(movedTo).toContain('reconcile-quarantine');
      expect(movedTo).toContain('scope-1');
      // Safety: never git clean / reset --hard.
      expect(runGit).not.toHaveBeenCalledWith(
        CLONE_ROOT,
        expect.arrayContaining(['clean']),
        expect.anything(),
      );
    });

    it('leaves ambiguous modified files for the agent and reports shared_clone_dirty', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M src/feature.ts\0', stderr: '' };
        }
        if (args[0] === 'ls-tree') {
          return { code: 0, stdout: 'src/feature.ts\0', stderr: '' };
        }
        return ok;
      });
      const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

      const result = await service.reconcileSharedCloneIntegration(
        'scope-1',
        SOURCE,
        BASE,
      );

      expect(result.outcome).toBe('shared_clone_dirty');
      expect(result.dirtyPaths).toEqual(['src/feature.ts']);
      expect(result.sharedClonePath).toBe(CLONE_ROOT);
      expect(runGit).not.toHaveBeenCalledWith(
        CLONE_ROOT,
        expect.arrayContaining(['checkout']),
        expect.anything(),
      );
    });

    it('surfaces the shared clone path on preflight results', async () => {
      stubCapture((repoPath, args) => {
        if (args[0] === 'status') return ok;
        if (args[0] === 'ls-tree') {
          return { code: 0, stdout: 'src/feature.ts\0', stderr: '' };
        }
        return ok;
      });

      const result = await service.preflightSharedCloneIntegration(
        'scope-1',
        SOURCE,
        BASE,
      );

      expect(result.outcome).toBe('succeeded');
      expect(result.sharedClonePath).toBe(CLONE_ROOT);
    });
  });

  it('returns quality_gate_failed (no retry) when the push is rejected by the pre-push hook', async () => {
    // Worktree stage is clean (feature already contains base); integration pushes.
    stubCapture((repoPath, args) => {
      if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) return fail; // not in progress
      if (args[0] === 'merge-base') return ok; // base IS an ancestor → worktree ready
      if (args[0] === 'rev-parse' && args.includes(`origin/${BASE}`)) return ok;
      if (args.includes('push')) {
        return {
          code: 1,
          stdout:
            'Pre-push: running lint across all workspaces...\neslint found errors',
          stderr: "error: failed to push some refs to 'origin'",
        };
      }
      return ok;
    });
    vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

    const result = await service.mergeWithConflictDetection(
      'scope-1',
      SOURCE,
      BASE,
      WORKTREE,
    );

    expect(result.outcome).toBe('quality_gate_failed');
    expect(result.qualityGateLog).toContain('eslint found errors');
    expect(result.qualityGateLog).toContain('failed to push some refs');
  });

  describe('pushFeatureBranch', () => {
    it('pushes the feature branch hook-free and never touches the base', async () => {
      const runGit = vi.spyOn(service, 'runGit').mockResolvedValue(undefined);

      await service.pushFeatureBranch('scope-1', SOURCE);

      expect(authEnvResolver.resolveProjectGitAuthEnv).toHaveBeenCalledWith(
        'scope-1',
      );
      expect(runGit).toHaveBeenCalledWith(
        CLONE_ROOT,
        ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', SOURCE],
        expect.anything(),
      );
      // The base branch is never modified by a feature-branch push.
      expect(runGit).not.toHaveBeenCalledWith(
        CLONE_ROOT,
        expect.arrayContaining(['push', 'origin', BASE]),
        expect.anything(),
      );
    });

    it('throws when the scope does not resolve to a git repository', async () => {
      vi.spyOn(service, 'resolveGitRepoPath').mockResolvedValue(null);

      await expect(
        service.pushFeatureBranch('scope-1', SOURCE),
      ).rejects.toThrow(/not a git repository/i);
    });
  });
});
