import { BadRequestException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitOpsOutboundSyncService } from './gitops-outbound-sync.service';
import type { GitOpsRepositoryBindingRepository } from './database/repositories/gitops-repository-binding.repository';
import type { GitOpsPendingChangeRepository } from './database/repositories/gitops-pending-change.repository';
import type { GitOpsReconcileRunRepository } from './database/repositories/gitops-reconcile-run.repository';
import type { GitOpsObjectRegistryService } from './objects/gitops-object-registry.service';
import type { GitCommandService } from '../common/git/git-command/git-command.service';
import type { GitOpsInvocationBuilder } from './gitops-invocation-builder';

describe('GitOpsOutboundSyncService', () => {
  let workspaceBase: string;
  let previousWorkspaceBase: string | undefined;

  beforeEach(async () => {
    previousWorkspaceBase = process.env.NEXUS_WORKSPACE_BASE_PATH;
    workspaceBase = await mkdtemp(path.join(tmpdir(), 'gitops-outbound-'));
    process.env.NEXUS_WORKSPACE_BASE_PATH = workspaceBase;
  });

  afterEach(async () => {
    if (previousWorkspaceBase === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
    } else {
      process.env.NEXUS_WORKSPACE_BASE_PATH = previousWorkspaceBase;
    }
    await rm(workspaceBase, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('rejects git-to-app bindings', async () => {
    const { service } = createService({
      binding: { syncMode: 'git_to_app' },
    });

    await expect(
      service.sync('scope-1', 'binding-1', { actorId: 'user-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serializes pending changes through object handlers and commits them', async () => {
    const pendingChange = {
      id: 'pending-1',
      bindingId: 'binding-1',
      objectType: 'workflow' as const,
      objectKey: '/acme:deploy',
      scopeNodeId: 'scope-1',
      changeType: 'update',
      payload: { name: 'deploy', scope: '/acme', definition: 'name: deploy' },
      baseRevision: 'rev-1',
      status: 'pending',
      createdByUserId: 'user-1',
    };
    const { service, git, pending, handler } = createService({
      pendingChanges: [pendingChange],
    });

    const result = await service.sync('scope-1', 'binding-1', {
      actorId: 'user-1',
    });

    expect(handler.normalizeDesired).toHaveBeenCalledWith({
      objectType: 'workflow',
      key: '/acme:deploy',
      fields: pendingChange.payload,
    });
    expect(handler.serialize).toHaveBeenCalled();
    expect(git.exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['checkout', '-B']),
      expect.any(Object),
    );
    expect(git.exec).toHaveBeenCalledWith(
      expect.any(String),
      ['add', '.'],
      expect.any(Object),
    );
    expect(git.exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['commit', '-m']),
      expect.any(Object),
    );
    expect(git.exec).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['push', 'origin']),
      expect.any(Object),
    );
    expect(pending.update).toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({ status: 'synced' }),
    );
    expect(result).toMatchObject({
      bindingId: 'binding-1',
      pendingChangeCount: 1,
    });

    const serialized = await readFile(
      path.join(
        workspaceBase,
        'gitops',
        'outbound',
        'binding-1',
        'outbound',
        'workflow',
        '_acme_deploy.yaml',
      ),
      'utf8',
    );
    expect(serialized).toContain('objectType: workflow');
    expect(serialized).toContain('definition: "name: deploy"');
  });

  it('persists a failed outbound run if git commit fails', async () => {
    const { service, git, runs, pending } = createService({
      pendingChanges: [
        {
          id: 'pending-1',
          bindingId: 'binding-1',
          objectType: 'workflow' as const,
          objectKey: 'deploy',
          scopeNodeId: 'scope-1',
          changeType: 'update',
          payload: { name: 'deploy' },
          baseRevision: 'rev-1',
          status: 'pending',
          createdByUserId: 'user-1',
        },
      ],
    });
    git.exec.mockImplementation((_repoPath: string, args: string[]) => {
      if (args[0] === 'commit') {
        throw new Error('commit failed');
      }
      return { stdout: '', stderr: '' };
    });

    await expect(
      service.sync('scope-1', 'binding-1', { actorId: 'user-1' }),
    ).rejects.toThrow('commit failed');

    expect(runs.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errors: [{ message: 'commit failed' }],
      }),
    );
    expect(pending.update).not.toHaveBeenCalledWith(
      'pending-1',
      expect.objectContaining({ status: 'synced' }),
    );
  });

  function createService(
    overrides: {
      binding?: Record<string, unknown>;
      pendingChanges?: Array<Record<string, unknown>>;
    } = {},
  ) {
    const binding = bindingFixture(overrides.binding);
    const bindings = {
      findById: vi.fn().mockResolvedValue(binding),
    } as unknown as GitOpsRepositoryBindingRepository;
    const pending = {
      findByBindingId: vi
        .fn()
        .mockResolvedValue(overrides.pendingChanges ?? []),
      update: vi.fn().mockResolvedValue(null),
    } as unknown as GitOpsPendingChangeRepository;
    const runs = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({ id: 'run-1' }),
    } as unknown as GitOpsReconcileRunRepository;
    const handler = {
      objectType: 'workflow',
      normalizeDesired: vi.fn((input) => input),
      serialize: vi.fn((actual) => ({ ...actual, managedBy: 'gitops' })),
    };
    const registry = {
      getHandler: vi.fn().mockReturnValue(handler),
    } as unknown as GitOpsObjectRegistryService;
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as unknown as GitCommandService;
    // Milestone-2: the outbound sync now routes every git
    // invocation through `GitOpsInvocationBuilder`. The
    // default stub returns the input args + cwd + empty env
    // unchanged, which is sufficient for the existing
    // behaviour assertions; the builder's own spec covers
    // the credential-injection paths.
    const invocationBuilder = {
      build: vi
        .fn()
        .mockImplementation(async (input: { args: string[]; cwd: string }) => ({
          args: input.args,
          cwd: input.cwd,
          env: {},
          cleanup: async (): Promise<void> => undefined,
        })),
    } as unknown as GitOpsInvocationBuilder;
    return {
      service: new GitOpsOutboundSyncService(
        bindings,
        pending,
        runs,
        registry,
        git,
        invocationBuilder,
      ),
      pending,
      runs,
      registry,
      handler,
      git: git as unknown as {
        exec: ReturnType<typeof vi.fn>;
      },
      invocationBuilder,
    };
  }

  function bindingFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'binding-1',
      scopeNodeId: 'scope-1',
      name: 'main',
      repoUrl: 'https://example.com/repo.git',
      defaultRef: 'main',
      rootPath: '.',
      syncMode: 'two_way' as const,
      enabled: true,
      includedObjectTypes: ['workflow'],
      conflictPolicy: 'require_review',
      lastAppliedRevision: 'rev-1',
      createdByUserId: 'user-1',
      ...overrides,
    };
  }
});
