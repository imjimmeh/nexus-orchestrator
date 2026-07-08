import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitInitService } from './git-init.service';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const mkdirMock = vi.mocked(mkdir);
const execFileMock = vi.mocked(execFile);

function stubExecFileSuccess(): void {
  execFileMock.mockImplementation(
    (
      _cmd: unknown,
      _args: unknown,
      callback: (
        err: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      callback(null, { stdout: '', stderr: '' });
      return {} as ReturnType<typeof execFile>;
    },
  );
}

describe('GitInitService', () => {
  let service: GitInitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitInitService();
    stubExecFileSuccess();
  });

  describe('initRepository', () => {
    it('creates the directory recursively', async () => {
      await service.initRepository('/repos/project-1');

      expect(mkdirMock).toHaveBeenCalledWith('/repos/project-1', {
        recursive: true,
      });
    });

    it('runs git init in the target directory', async () => {
      await service.initRepository('/repos/project-1');

      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['init', '/repos/project-1'],
        expect.any(Function),
      );
    });

    it('creates an initial empty commit', async () => {
      await service.initRepository('/repos/project-1');

      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        [
          '-C',
          '/repos/project-1',
          'commit',
          '--allow-empty',
          '-m',
          'Initial commit',
        ],
        expect.any(Function),
      );
    });

    it('configures git user identity before committing', async () => {
      await service.initRepository('/repos/project-1');

      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['-C', '/repos/project-1', 'config', 'user.name', 'Nexus Orchestrator'],
        expect.any(Function),
      );
      expect(execFileMock).toHaveBeenCalledWith(
        'git',
        ['-C', '/repos/project-1', 'config', 'user.email', 'nexus@localhost'],
        expect.any(Function),
      );
    });

    it('returns the repo path', async () => {
      const result = await service.initRepository('/repos/project-1');

      expect(result).toBe('/repos/project-1');
    });

    it('propagates errors from git init', async () => {
      execFileMock.mockImplementation(
        (
          _cmd: unknown,
          _args: unknown,
          callback: (err: Error | null) => void,
        ) => {
          callback(new Error('git not found'));
          return {} as ReturnType<typeof execFile>;
        },
      );

      await expect(service.initRepository('/repos/project-1')).rejects.toThrow(
        'git not found',
      );
    });
  });

  describe('getDefaultRepoPath', () => {
    it('uses NEXUS_WORKSPACE_BASE_PATH env when set', () => {
      const original = process.env.NEXUS_WORKSPACE_BASE_PATH;
      process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';

      try {
        const result = service.getDefaultRepoPath('project-123');
        expect(result).toBe(
          path.resolve('/data/nexus-workspaces', 'repos', 'project-123'),
        );
      } finally {
        if (original === undefined) {
          delete process.env.NEXUS_WORKSPACE_BASE_PATH;
        } else {
          process.env.NEXUS_WORKSPACE_BASE_PATH = original;
        }
      }
    });

    it('falls back to tmpdir when env is not set', () => {
      const original = process.env.NEXUS_WORKSPACE_BASE_PATH;
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;

      try {
        const result = service.getDefaultRepoPath('project-456');
        expect(result).toBe(
          path.resolve(os.tmpdir(), 'nexus-workspaces', 'repos', 'project-456'),
        );
      } finally {
        if (original !== undefined) {
          process.env.NEXUS_WORKSPACE_BASE_PATH = original;
        }
      }
    });
  });
});
