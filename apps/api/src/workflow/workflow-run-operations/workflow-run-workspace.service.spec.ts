import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunWorkspaceService } from './workflow-run-workspace.service';
import * as fs from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import { NotFoundException } from '@nestjs/common';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('WorkflowRunWorkspaceService', () => {
  const workflowPersistence = {
    getWorkflowRun: vi.fn().mockResolvedValue({
      id: 'run-1',
      current_step_id: 'step-1',
      state_variables: {},
    }),
  };

  const gitWorktreeService = {
    getExistingWorktreePath: vi.fn().mockResolvedValue(null),
  };

  function createService() {
    return new WorkflowRunWorkspaceService(
      workflowPersistence as never,
      gitWorktreeService as never,
    );
  }

  it('falls back to active worktree path when exported workspace is missing', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('missing export'));
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      {
        name: 'README.md',
        isDirectory: () => false,
      },
    ] as never);
    vi.mocked(workflowPersistence.getWorkflowRun).mockResolvedValueOnce({
      id: 'run-1',
      current_step_id: 'step-1',
      state_variables: {
        trigger: {
          scopeId: 'project-1',
          contextId: 'item-1',
        },
      },
    });
    vi.mocked(gitWorktreeService.getExistingWorktreePath).mockResolvedValueOnce(
      '/tmp/worktrees/project-1/item-1',
    );

    const service = createService();
    const result = await service.getFileTree('run-1');

    expect(gitWorktreeService.getExistingWorktreePath).toHaveBeenCalledWith(
      'project-1',
      'item-1',
    );
    expect(result).toEqual([
      {
        name: 'README.md',
        path: 'README.md',
        type: 'file',
      },
    ]);
  });

  it('returns file tree for resolved run workspace', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: 'src',
          isDirectory: () => true,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          name: 'main.ts',
          isDirectory: () => false,
        },
      ] as never);

    const service = createService();
    const result = await service.getFileTree('run-1');

    expect(result).toEqual([
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [{ name: 'main.ts', path: 'src/main.ts', type: 'file' }],
      },
    ]);
  });

  it('returns a stable diff string payload', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    vi.mocked(childProcess.execFile).mockImplementation(
      (_command, _args, optionsOrCallback, callback) => {
        const cb =
          typeof optionsOrCallback === 'function'
            ? optionsOrCallback
            : callback;
        cb?.(null, 'diff --git a/a.ts b/a.ts', '');
        return {} as never;
      },
    );

    const service = createService();
    const result = await service.getDiff('run-1');

    expect(typeof result).toBe('string');
  });

  it('returns an empty tree when the run has no active workspace', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('missing export'));
    vi.mocked(workflowPersistence.getWorkflowRun).mockResolvedValueOnce({
      id: 'run-2',
      current_step_id: null,
      state_variables: {},
    });

    const service = createService();
    const result = await service.getFileTree('run-2');

    expect(result).toEqual([]);
  });

  it('returns an empty diff when the run has no active workspace', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('missing export'));
    vi.mocked(workflowPersistence.getWorkflowRun).mockResolvedValueOnce({
      id: 'run-3',
      current_step_id: null,
      state_variables: {},
    });

    const service = createService();
    const result = await service.getDiff('run-3');

    expect(result).toBe('');
  });

  it('rethrows not found when workflow run does not exist', async () => {
    vi.mocked(workflowPersistence.getWorkflowRun).mockRejectedValueOnce(
      new NotFoundException('Workflow run missing not found'),
    );

    const service = createService();

    await expect(service.getFileTree('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
