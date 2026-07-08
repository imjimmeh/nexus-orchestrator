import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import type { AttachmentsService } from '../../attachments/attachments.service';
import type { InternalToolExecutionContext } from '@nexus/core';
import { GetAttachmentTool } from './get-attachment.tool';

vi.mock('fs/promises');

describe('GetAttachmentTool', () => {
  beforeEach(() => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('materializes the original into the worktree and returns the path', async () => {
    const attachmentId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const attachments = {
      getMetadata: vi.fn().mockResolvedValue({
        id: attachmentId,
        filename: 'a.pdf',
        mime_type: 'application/pdf',
        storage_key: 'abc/original',
      }),
      getContent: vi.fn().mockResolvedValue({
        body: Buffer.from('%PDF'),
        contentType: 'application/pdf',
      }),
      getParsed: vi
        .fn()
        .mockResolvedValue({ status: 'parsed', content: '# parsed' }),
    };
    const tool = new GetAttachmentTool(
      attachments as unknown as AttachmentsService,
    );

    const result = await tool.execute(
      { workflowRunId: 'run-1' },
      { attachment_id: attachmentId },
    );

    expect(result.path).toContain(attachmentId);
    expect(result.parsed_content).toBe('# parsed');
    expect(result.parse_status).toBe('parsed');
    const writeSpy = vi.mocked(fs.writeFile);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
      Buffer.from('%PDF'),
    );
  });

  it('rejects a non-UUID attachment_id via schema validation', async () => {
    const tool = new GetAttachmentTool({} as unknown as AttachmentsService);
    await expect(
      tool.execute(
        {},
        {
          attachment_id: '../etc/passwd',
        },
      ),
    ).rejects.toThrow();
  });

  it('returns the tool name', () => {
    const tool = new GetAttachmentTool({} as unknown as AttachmentsService);
    expect(tool.getName()).toBe('get_attachment');
  });
});
