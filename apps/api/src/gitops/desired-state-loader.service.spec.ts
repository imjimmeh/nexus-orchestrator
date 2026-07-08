import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { DesiredStateLoaderService } from './desired-state-loader.service';

/**
 * Milestone-2: the loader now takes a
 * `GitOpsInvocationBuilder` collaborator. The existing
 * behaviour tests assert on the legacy `git.exec` path (no
 * binding metadata in the input), so a no-op stub is
 * sufficient here. The builder's own spec covers the
 * credentialed paths.
 */
function buildInvocationBuilderStub(): {
  build: ReturnType<typeof vi.fn>;
} {
  return {
    build: vi
      .fn()
      .mockImplementation(async (input: { args: string[]; cwd: string }) => ({
        args: input.args,
        cwd: input.cwd,
        env: {},
        cleanup: async (): Promise<void> => undefined,
      })),
  };
}

const builderStub = buildInvocationBuilderStub();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    mkdir: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    rm: vi.fn(),
  };
});

describe('DesiredStateLoaderService', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.realpath).mockImplementation(async (value) => String(value));
    vi.mocked(fsp.stat).mockResolvedValue({ isDirectory: () => true } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clones/refreshes the repo then validates into DesiredState', async () => {
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn().mockResolvedValue({
        prune: true,
        objects: [{ type: 'role', key: 'viewer', fields: {} }],
      }),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce('/tmp/gitops-repo')
      .mockResolvedValueOnce('/tmp/gitops-repo');
    const state = await svc.load({
      repoUrl: 'https://example.com/repo.git',
      ref: 'main',
    });
    expect(git.exec).toHaveBeenCalled();
    expect(validation.loadAndValidate).toHaveBeenCalled();
    expect(state.objects).toHaveLength(1);
    expect(state.prune).toBe(true);
  });

  it('rejects a rootPath symlink that resolves outside the checkout', async () => {
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn(),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    const repoPath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'gitops-test-repo-'),
    );
    const outsidePath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'gitops-outside-'),
    );
    fs.mkdirSync(path.join(repoPath, '.git'));
    fs.symlinkSync(
      outsidePath,
      path.join(repoPath, 'outside-link'),
      'junction',
    );
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce(repoPath)
      .mockResolvedValueOnce(outsidePath);

    await expect(
      svc.load({
        repoUrl: 'https://example.com/repo.git',
        ref: 'main',
        workspacePath: repoPath,
        rootPath: 'outside-link',
      }),
    ).rejects.toThrow(/escapes the checkout/i);

    expect(validation.loadAndValidate).not.toHaveBeenCalled();
  });

  it('rejects a rootPath that resolves to a file', async () => {
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn(),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    const repoPath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'gitops-file-root-'),
    );
    const rootFile = path.join(repoPath, 'root.yaml');
    fs.mkdirSync(path.join(repoPath, '.git'));
    fs.writeFileSync(rootFile, 'apiVersion: nexus.gitops/v1\n');
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce(repoPath)
      .mockResolvedValueOnce(rootFile);
    vi.mocked(fsp.stat).mockResolvedValueOnce({
      isDirectory: () => false,
    } as any);

    await expect(
      svc.load({
        repoUrl: 'https://example.com/repo.git',
        ref: 'main',
        workspacePath: repoPath,
        rootPath: 'root.yaml',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(validation.loadAndValidate).not.toHaveBeenCalled();
  });

  it('derives a canonical layout prefix from a symlinked subtree', async () => {
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn().mockResolvedValue({ prune: false, objects: [] }),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    const repoPath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'gitops-prefix-root-'),
    );
    const scopesDir = path.join(repoPath, 'scopes');
    const scopeDir = path.join(scopesDir, 'acme');
    const aliasDir = path.join(repoPath, 'binding-root');
    fs.mkdirSync(path.join(repoPath, '.git'));
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(scopeDir, aliasDir, 'junction');
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce(repoPath)
      .mockResolvedValueOnce(scopeDir);

    await svc.load({
      repoUrl: 'https://example.com/repo.git',
      ref: 'main',
      workspacePath: repoPath,
      rootPath: 'binding-root',
    });

    expect(validation.loadAndValidate).toHaveBeenCalledWith(
      scopeDir,
      undefined,
      { pathPrefix: 'scopes/acme' },
    );
  });

  it('reclones when the existing checkout points at a different origin', async () => {
    const git = {
      exec: vi.fn().mockImplementation(async (_cwd: string, args: string[]) => {
        if (args[0] === 'remote') {
          return { stdout: 'https://example.com/other.git\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn().mockResolvedValue({ prune: false, objects: [] }),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    const workspacePath = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'gitops-stale-checkout-'),
    );
    fs.mkdirSync(path.join(workspacePath, '.git'));
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce(workspacePath)
      .mockResolvedValueOnce(workspacePath);

    await svc.load({
      repoUrl: 'https://example.com/repo.git',
      ref: 'main',
      workspacePath,
    });

    expect(git.exec).toHaveBeenCalledWith(workspacePath, [
      'remote',
      'get-url',
      'origin',
    ]);
    expect(git.exec).toHaveBeenCalledWith(workspacePath, [
      'clone',
      '--depth',
      '1',
      '--branch',
      'main',
      '--',
      'https://example.com/repo.git',
      '.',
    ]);
    expect(git.exec).not.toHaveBeenCalledWith(workspacePath, [
      'fetch',
      '--prune',
      'origin',
      'main',
    ]);
  });

  it('rejects an unsafe repo URL (credentials embedded)', async () => {
    const svc = new DesiredStateLoaderService(
      {} as any,
      {} as any,
      builderStub,
    );
    await expect(
      svc.load({
        repoUrl: 'https://user:pass@example.com/repo.git',
        ref: 'main',
      }),
    ).rejects.toThrow(/credential/i);
  });

  it('rejects a non-HTTPS URL (http://)', async () => {
    const svc = new DesiredStateLoaderService(
      {} as any,
      {} as any,
      builderStub,
    );
    await expect(
      svc.load({ repoUrl: 'http://example.com/repo.git', ref: 'main' }),
    ).rejects.toThrow();
  });

  it('propagates validation failures (does not return a partial plan)', async () => {
    const git = {
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as any;
    const validation = {
      loadAndValidate: vi
        .fn()
        .mockRejectedValue(new Error('schema invalid: roles[0].name required')),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce('/tmp/gitops-repo')
      .mockResolvedValueOnce('/tmp/gitops-repo');
    await expect(
      svc.load({ repoUrl: 'https://example.com/repo.git', ref: 'main' }),
    ).rejects.toThrow(/schema invalid/);
  });

  it('serializes concurrent loads for the same workspace path', async () => {
    const releaseFirst = { done: false };
    let active = 0;
    let maxActive = 0;
    const git = {
      exec: vi.fn().mockImplementation(async (_cwd: string, args: string[]) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (args[0] === 'clone' && !releaseFirst.done) {
            await new Promise<void>((resolve) => {
              setTimeout(() => {
                releaseFirst.done = true;
                resolve();
              }, 25);
            });
          }
          return { stdout: 'https://example.com/repo.git\n', stderr: '' };
        } finally {
          active -= 1;
        }
      }),
    } as any;
    const validation = {
      loadAndValidate: vi.fn().mockResolvedValue({ prune: false, objects: [] }),
    } as any;
    const svc = new DesiredStateLoaderService(git, validation, builderStub);
    vi.mocked(fsp.realpath)
      .mockResolvedValueOnce('/tmp/gitops-repo')
      .mockResolvedValueOnce('/tmp/gitops-repo')
      .mockResolvedValueOnce('/tmp/gitops-repo')
      .mockResolvedValueOnce('/tmp/gitops-repo');

    await Promise.all([
      svc.load({
        repoUrl: 'https://example.com/repo.git',
        ref: 'main',
        workspacePath: '/tmp/gitops-repo',
      }),
      svc.load({
        repoUrl: 'https://example.com/repo.git',
        ref: 'main',
        workspacePath: '/tmp/gitops-repo',
      }),
    ]);

    expect(maxActive).toBe(1);
  });
});
