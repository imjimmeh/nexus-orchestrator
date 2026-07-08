import { describe, expect, it, vi } from 'vitest';
import { AttachmentParseProcessor } from './attachment-parse.processor';

function build() {
  const attachments = { findById: vi.fn(), update: vi.fn() };
  const storage = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const docParser = { parse: vi.fn() };
  const imageDescriber = { describe: vi.fn() };
  const processor = new AttachmentParseProcessor(
    attachments as never,
    storage,
    docParser as never,
    imageDescriber as never,
  );
  return { processor, attachments, storage, docParser, imageDescriber };
}

describe('AttachmentParseProcessor', () => {
  it('parses a document and stores markdown, marking parsed', async () => {
    const { processor, attachments, storage, docParser } = build();
    attachments.findById.mockResolvedValue({
      id: 'att-1',
      filename: 'a.pdf',
      mime_type: 'application/pdf',
      storage_key: 'abc/original',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('%PDF'),
      contentType: 'application/pdf',
    });
    docParser.parse.mockResolvedValue({
      filename: 'a.pdf',
      content: '# parsed',
      word_count: 1,
      truncated: false,
    });

    await processor.process({
      data: { attachmentId: 'att-1', visionEager: true },
    });

    expect(storage.put).toHaveBeenCalledWith(
      'att-1/parsed.md',
      expect.any(Buffer),
      'text/markdown',
    );
    expect(attachments.update).toHaveBeenLastCalledWith('att-1', {
      parse_status: 'parsed',
      parsed_key: 'att-1/parsed.md',
    });
  });

  it('skips image vision when visionEager is false', async () => {
    const { processor, attachments, storage, imageDescriber } = build();
    attachments.findById.mockResolvedValue({
      id: 'att-2',
      filename: 'a.png',
      mime_type: 'image/png',
      storage_key: 'xyz/original',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('x'),
      contentType: 'image/png',
    });

    await processor.process({
      data: { attachmentId: 'att-2', visionEager: false },
    });

    expect(imageDescriber.describe).not.toHaveBeenCalled();
    expect(attachments.update).toHaveBeenLastCalledWith('att-2', {
      parse_status: 'skipped',
    });
  });

  it('marks failed on parser error without throwing', async () => {
    const { processor, attachments, storage, docParser } = build();
    attachments.findById.mockResolvedValue({
      id: 'att-3',
      filename: 'a.pdf',
      mime_type: 'application/pdf',
      storage_key: 'abc/original',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('x'),
      contentType: 'application/pdf',
    });
    docParser.parse.mockRejectedValue(new Error('corrupt'));

    await processor.process({
      data: { attachmentId: 'att-3', visionEager: true },
    });

    expect(attachments.update).toHaveBeenLastCalledWith('att-3', {
      parse_status: 'failed',
      parse_error: 'corrupt',
    });
  });

  it('processes an image when visionEager is true', async () => {
    const { processor, attachments, storage, imageDescriber } = build();
    attachments.findById.mockResolvedValue({
      id: 'att-4',
      filename: 'a.png',
      mime_type: 'image/png',
      storage_key: 'xyz/original',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('x'),
      contentType: 'image/png',
    });
    imageDescriber.describe.mockResolvedValue({
      available: true,
      markdown: '# image',
    });

    await processor.process({
      data: { attachmentId: 'att-4', visionEager: true },
    });

    expect(imageDescriber.describe).toHaveBeenCalled();
    expect(attachments.update).toHaveBeenLastCalledWith('att-4', {
      parse_status: 'parsed',
      parsed_key: 'att-4/parsed.md',
    });
  });
});
