import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitVerificationHandler } from './commit-verification.handler';

describe('CommitVerificationHandler', () => {
  let handler: CommitVerificationHandler;

  beforeEach(() => {
    handler = new CommitVerificationHandler();
    vi.resetAllMocks();
  });

  it('returns verified status when working tree is clean', async () => {
    const mockExecAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    handler['execAsync'] = mockExecAsync;

    const result = await handler.verify('/path/to/worktree');

    expect(mockExecAsync).toHaveBeenCalledWith('git status --short', {
      cwd: '/path/to/worktree',
    });
    expect(result.status).toBe('verified');
    expect(result.uncommittedFiles).toEqual([]);
  });

  it('returns needs_commit status when files are uncommitted', async () => {
    const mockExecAsync = vi.fn().mockResolvedValue({
      stdout: ' M docs/PRD.md\n?? docs/SDD.md\n',
      stderr: '',
    });
    handler['execAsync'] = mockExecAsync;

    const result = await handler.verify('/path/to/worktree');

    expect(result.status).toBe('needs_commit');
    expect(result.uncommittedFiles).toEqual(['docs/PRD.md', 'docs/SDD.md']);
  });

  it('throws on exec error', async () => {
    const mockExecAsync = vi
      .fn()
      .mockRejectedValue(new Error('not a git repo'));
    handler['execAsync'] = mockExecAsync;

    await expect(handler.verify('/bad/path')).rejects.toThrow('not a git repo');
  });
});
