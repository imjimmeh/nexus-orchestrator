import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { CreateArtifactTool } from './create-artifact.tool';

vi.mock('fs/promises');

describe('CreateArtifactTool', () => {
  beforeEach(() => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
  });

  it('exposes the create_artifact tool name', () => {
    expect(new CreateArtifactTool().getName()).toBe('create_artifact');
  });

  it('rejects path traversal attempts', async () => {
    const tool = new CreateArtifactTool();
    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        {
          path: '../../../etc/evil.sh',
          content: 'rm -rf /',
        },
      ),
    ).rejects.toThrow('Invalid path');
  });

  it('creates the file and returns structured result', async () => {
    const tool = new CreateArtifactTool();
    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { path: '/workspace/project/docs/PRD.md', content: '# PRD' },
    );

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/workspace/project/docs/PRD.md',
      '# PRD',
      'utf8',
    );
    expect(result).toMatchObject({
      path: '/workspace/project/docs/PRD.md',
      created: true,
      size_bytes: expect.any(Number),
    });
  });

  it('fails if file exists and force is not set', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    const tool = new CreateArtifactTool();
    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        {
          path: '/workspace/project/docs/PRD.md',
          content: '# PRD',
        },
      ),
    ).rejects.toThrow('already exists');
  });

  it('overwrites if force is true', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
    const tool = new CreateArtifactTool();
    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      {
        path: '/workspace/project/docs/PRD.md',
        content: '# Updated PRD',
        force: true,
      },
    );
    expect(result.created).toBe(true);
  });
});
