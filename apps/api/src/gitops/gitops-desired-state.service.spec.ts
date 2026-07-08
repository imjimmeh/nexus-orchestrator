import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { GitOpsDesiredStateService } from './gitops-desired-state.service';

describe('GitOpsDesiredStateService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads desired state from a binding checkout rooted at the binding path', async () => {
    const bindingRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'binding-1',
        repoUrl: 'https://example.com/gitops.git',
        defaultRef: 'release/2026.06',
        rootPath: 'scopes/acme',
        enabled: true,
      }),
    };
    const loader = {
      load: vi.fn().mockResolvedValue({ prune: true, objects: [] }),
    };

    const service = new GitOpsDesiredStateService(
      bindingRepo as never,
      loader as never,
    );

    await service.loadForBinding('binding-1', { actorId: 'user-1' });

    expect(bindingRepo.findById).toHaveBeenCalledWith('binding-1');
    expect(loader.load).toHaveBeenCalledWith({
      repoUrl: 'https://example.com/gitops.git',
      ref: 'release/2026.06',
      workspacePath: expect.stringContaining(
        path.join('gitops', 'bindings', 'binding-1'),
      ),
      rootPath: 'scopes/acme',
      binding: {
        id: 'binding-1',
        credentialsSecretId: null,
      },
    });
  });

  it('uses binding repo values even when a different repo env var is set', async () => {
    vi.stubEnv('GITOPS_REPO_URL', 'https://example.com/ignored.git');

    const bindingRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'binding-1',
        repoUrl: 'https://example.com/gitops.git',
        defaultRef: 'release/2026.06',
        rootPath: 'scopes/acme',
        enabled: true,
      }),
    };
    const loader = {
      load: vi.fn().mockResolvedValue({ prune: true, objects: [] }),
    };

    const service = new GitOpsDesiredStateService(
      bindingRepo as never,
      loader as never,
    );

    await service.loadForBinding('binding-1', { actorId: 'user-1' });

    expect(loader.load).toHaveBeenCalledWith({
      repoUrl: 'https://example.com/gitops.git',
      ref: 'release/2026.06',
      workspacePath: expect.stringContaining(
        path.join('gitops', 'bindings', 'binding-1'),
      ),
      rootPath: 'scopes/acme',
      binding: {
        id: 'binding-1',
        credentialsSecretId: null,
      },
    });
  });

  it('refuses disabled bindings', async () => {
    const bindingRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'binding-1',
        repoUrl: 'https://example.com/gitops.git',
        defaultRef: 'main',
        rootPath: '.',
        enabled: false,
      }),
    };
    const loader = {
      load: vi.fn(),
    };

    const service = new GitOpsDesiredStateService(
      bindingRepo as never,
      loader as never,
    );

    await expect(
      service.loadForBinding('binding-1', { actorId: 'user-1' }),
    ).rejects.toThrow(/disabled/i);

    expect(loader.load).not.toHaveBeenCalled();
  });
});
