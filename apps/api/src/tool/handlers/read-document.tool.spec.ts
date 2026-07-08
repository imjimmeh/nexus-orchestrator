import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { ReadDocumentTool } from './read-document.tool';
import { DocumentParserService } from '../../attachments/parsing/document-parser.service';

describe('ReadDocumentTool', () => {
  it('exposes the read_document tool name', () => {
    expect(new ReadDocumentTool(new DocumentParserService()).getName()).toBe(
      'read_document',
    );
  });

  it('rejects path traversal attempts', async () => {
    const tool = new ReadDocumentTool(new DocumentParserService());
    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        { file_path: '../../../etc/passwd' },
      ),
    ).rejects.toThrow('Invalid path');
  });

  it('returns structured content for a text file', async () => {
    const tool = new ReadDocumentTool(new DocumentParserService());
    vi.spyOn(tool as any, 'readTextFile').mockResolvedValue('Hello, world!');

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { file_path: path.join(process.cwd(), 'notes.txt') },
    );

    expect(result).toMatchObject({
      filename: 'notes.txt',
      content: 'Hello, world!',
      word_count: expect.any(Number),
    });
  });

  it('truncates large files to 100KB', async () => {
    const tool = new ReadDocumentTool(new DocumentParserService());
    vi.spyOn(tool as any, 'readTextFile').mockResolvedValue(
      'x'.repeat(200_000),
    );

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { file_path: path.join(process.cwd(), 'large.md') },
    );

    expect((result.content as string).length).toBeLessThanOrEqual(100_000);
    expect(result.truncated).toBe(true);
  });
});
