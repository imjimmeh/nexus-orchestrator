import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitWorktreeService } from './git-worktree.service';

const UUID_SCOPE_ID = '70945876-acf1-4ec4-bd7b-ea0121f90140';

function buildService() {
  const gitCommand = {} as never;
  const branchOps = {
    hasLocalBranch: vi.fn(),
    hasOriginRemote: vi.fn(),
    resolveBaseRef: vi.fn(),
    fastForwardBranchToBase: vi.fn(),
  } as any;
  const lockService = { runRepoExclusive: vi.fn() } as any;
  const worktreeOps = {
    findWorktreeByPath: vi.fn(),
    listWorktrees: vi.fn(),
    addWorktree: vi.fn(),
  } as any;
  const eventLedger = { emitBestEffort: vi.fn() } as any;
  const pathService = {
    resolveGitRepoPath: vi.fn(),
    getWorktreeBasePath: vi.fn(),
    getWorktreePath: vi.fn(),
    isWithinRoot: vi.fn(),
  } as any;

  return {
    service: new GitWorktreeService(
      gitCommand,
      branchOps,
      lockService,
      pathService as never,
      worktreeOps,
      eventLedger,
    ),
    branchOps,
    lockService,
    worktreeOps,
    eventLedger,
    pathService,
  };
}

describe('GitWorktreeService', () => {
  let originalWorkspaceBasePath: string | undefined;

  beforeEach(() => {
    originalWorkspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;
    process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';
  });

  afterEach(() => {
    if (originalWorkspaceBasePath === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
      return;
    }

    process.env.NEXUS_WORKSPACE_BASE_PATH = originalWorkspaceBasePath;
  });

  it('uses provided path-like scope ids directly', async () => {
    const { service, pathService } = buildService();
    pathService.resolveGitRepoPath.mockResolvedValue('/repos/project-1');

    const result = await service.resolveProjectBasePath('/repos/project-1');

    expect(result).toBe('/repos/project-1');
    expect(pathService.resolveGitRepoPath).toHaveBeenCalledTimes(1);
    expect(pathService.resolveGitRepoPath).toHaveBeenCalledWith(
      '/repos/project-1',
    );
  });

  it('falls back to managed clone path for uuid scope ids', async () => {
    const { service, pathService } = buildService();
    pathService.resolveGitRepoPath
      .mockRejectedValueOnce(new Error('not a git repo'))
      .mockResolvedValueOnce(`/data/nexus-workspaces/clones/${UUID_SCOPE_ID}`);

    const result = await service.resolveProjectBasePath(UUID_SCOPE_ID);

    expect(result).toBe(`/data/nexus-workspaces/clones/${UUID_SCOPE_ID}`);
    expect(pathService.resolveGitRepoPath).toHaveBeenNthCalledWith(
      1,
      UUID_SCOPE_ID,
    );
    expect(pathService.resolveGitRepoPath).toHaveBeenNthCalledWith(
      2,
      `/data/nexus-workspaces/clones/${UUID_SCOPE_ID}`,
    );
  });

  describe('provisionWorktree', () => {
    it('rejects when target branch is already checked out by another managed worktree', async () => {
      const {
        service,
        branchOps,
        lockService,
        worktreeOps,
        eventLedger,
        pathService,
      } = buildService();

      const managedRoot = '/data/nexus-workspaces/worktrees/project-1';
      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.isWithinRoot.mockImplementation(
        (candidate: string, root: string) => {
          const normalizedCandidate = candidate.replace(/\\/g, '/');
          const normalizedRoot = root.replace(/\\/g, '/');
          return normalizedCandidate.startsWith(normalizedRoot);
        },
      );
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      worktreeOps.findWorktreeByPath.mockResolvedValue(null);
      const mockWorktrees = [
        {
          path: '/data/nexus-workspaces/worktrees/project-1/review-owner',
          branch: 'feature/automation-improvements',
          head: 'abc123',
        },
      ];
      worktreeOps.listWorktrees.mockResolvedValue(mockWorktrees);
      branchOps.hasLocalBranch.mockResolvedValue(true);

      const result = service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      await expect(result).rejects.toThrow(
        'Target branch feature/automation-improvements is already checked out',
      );
      expect(worktreeOps.addWorktree).not.toHaveBeenCalled();
      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'git.worktree.provision.failed',
          outcome: 'failure',
          errorMessage: expect.stringContaining(
            'feature/automation-improvements',
          ),
        }),
      );
      expect(pathService.isWithinRoot).toHaveBeenCalledWith(
        '/data/nexus-workspaces/worktrees/project-1/review-owner',
        expect.any(String),
      );
    });

    it('returns existing path when worktree already exists at the same path (idempotency)', async () => {
      const { service, lockService, worktreeOps, eventLedger, pathService } =
        buildService();

      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      worktreeOps.findWorktreeByPath.mockResolvedValue({
        path: '/data/nexus-workspaces/worktrees/project-1/todo-item',
        branch: 'feature/automation-improvements',
        head: 'abc123',
      });

      const result = await service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      expect(result).toBe(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      expect(worktreeOps.addWorktree).not.toHaveBeenCalled();
      expect(worktreeOps.findWorktreeByPath).toHaveBeenCalled();
    });

    it('does not throw branch-conflict when listed worktree matches same normalized requested path', async () => {
      const {
        service,
        lockService,
        worktreeOps,
        eventLedger,
        pathService,
        branchOps,
      } = buildService();

      const managedRoot = '/data/nexus-workspaces/worktrees/project-1';
      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.isWithinRoot.mockImplementation(
        (candidate: string, root: string) => {
          const normalizedCandidate = candidate.replace(/\\/g, '/');
          const normalizedRoot = root.replace(/\\/g, '/');
          return normalizedCandidate.startsWith(normalizedRoot);
        },
      );
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      // findWorktreeByPath returns null — no existing registration
      worktreeOps.findWorktreeByPath.mockResolvedValue(null);
      // listWorktrees returns a worktree on the same branch at the same path (different trailing slash)
      worktreeOps.listWorktrees.mockResolvedValue([
        {
          path: '/data/nexus-workspaces/worktrees/project-1/todo-item/',
          branch: 'feature/automation-improvements',
          head: 'abc123',
        },
      ]);
      branchOps.hasLocalBranch.mockResolvedValue(false);
      branchOps.resolveBaseRef.mockResolvedValue('refs/heads/main');

      const result = await service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      expect(result).toBe(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      expect(worktreeOps.addWorktree).toHaveBeenCalled();
    });

    it('proceeds when same-branch worktree is outside the managed root', async () => {
      const {
        service,
        lockService,
        worktreeOps,
        eventLedger,
        pathService,
        branchOps,
      } = buildService();

      const managedRoot = '/data/nexus-workspaces/worktrees/project-1';
      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.isWithinRoot.mockImplementation(
        (candidate: string, root: string) => {
          const normalizedCandidate = candidate.replace(/\\/g, '/');
          const normalizedRoot = root.replace(/\\/g, '/');
          return normalizedCandidate.startsWith(normalizedRoot);
        },
      );
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      worktreeOps.findWorktreeByPath.mockResolvedValue(null);
      // Same branch but path outside managed root — should be ignored by conflict detection
      worktreeOps.listWorktrees.mockResolvedValue([
        {
          path: '/external/worktrees/project-2/review-owner',
          branch: 'feature/automation-improvements',
          head: 'def456',
        },
      ]);
      branchOps.hasLocalBranch.mockResolvedValue(false);
      branchOps.resolveBaseRef.mockResolvedValue('refs/heads/main');

      const result = await service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      expect(result).toBe(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      expect(worktreeOps.addWorktree).toHaveBeenCalled();
    });

    it('fast-forwards a reused existing branch to the fresh origin base', async () => {
      const {
        service,
        lockService,
        worktreeOps,
        eventLedger,
        pathService,
        branchOps,
      } = buildService();

      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.isWithinRoot.mockReturnValue(false);
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      worktreeOps.findWorktreeByPath.mockResolvedValue(null);
      worktreeOps.listWorktrees.mockResolvedValue([]);
      branchOps.hasLocalBranch.mockResolvedValue(true);
      branchOps.resolveBaseRef.mockResolvedValue('origin/main');
      branchOps.fastForwardBranchToBase.mockResolvedValue('fast-forwarded');

      await service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      expect(branchOps.fastForwardBranchToBase).toHaveBeenCalledWith(
        '/data/nexus-workspaces/clones/project-1',
        'feature/automation-improvements',
        'origin/main',
      );
      expect(worktreeOps.addWorktree).toHaveBeenCalledWith(
        '/data/nexus-workspaces/clones/project-1',
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
        'feature/automation-improvements',
      );
      expect(eventLedger.emitBestEffort).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'git.worktree.branch.stale' }),
      );
    });

    it('preserves a diverged reused branch but emits a staleness warning', async () => {
      const {
        service,
        lockService,
        worktreeOps,
        eventLedger,
        pathService,
        branchOps,
      } = buildService();

      pathService.getWorktreeBasePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees',
      );
      pathService.getWorktreePath.mockReturnValue(
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
      );
      pathService.isWithinRoot.mockReturnValue(false);
      pathService.resolveGitRepoPath.mockResolvedValue(
        '/data/nexus-workspaces/clones/project-1',
      );

      lockService.runRepoExclusive = vi
        .fn()
        .mockImplementation(async (_repoPath: string, cb: () => any) => cb());

      worktreeOps.findWorktreeByPath.mockResolvedValue(null);
      worktreeOps.listWorktrees.mockResolvedValue([]);
      branchOps.hasLocalBranch.mockResolvedValue(true);
      branchOps.resolveBaseRef.mockResolvedValue('origin/main');
      branchOps.fastForwardBranchToBase.mockResolvedValue('preserved');

      await service.provisionWorktree(
        'project-1',
        'todo-item',
        'main',
        'feature/automation-improvements',
      );

      // Real work must never be discarded — the worktree is still created.
      expect(worktreeOps.addWorktree).toHaveBeenCalledWith(
        '/data/nexus-workspaces/clones/project-1',
        '/data/nexus-workspaces/worktrees/project-1/todo-item',
        'feature/automation-improvements',
      );
      // But the staleness is surfaced for observability.
      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: 'git.worktree.branch.stale' }),
      );
    });
  });
});
