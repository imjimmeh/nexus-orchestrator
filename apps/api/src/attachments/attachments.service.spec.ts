import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

function buildService() {
  const attachments = {
    findByChecksum: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockImplementation((d) =>
        Promise.resolve({ id: 'att-1', parse_status: 'pending', ...d }),
      ),
    findById: vi.fn(),
    update: vi.fn(),
  };
  const links = { link: vi.fn(), findAttachmentsForOwner: vi.fn() };
  const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
  const queue = { add: vi.fn() };
  const configValue = {
    maxSizeBytes: 25 * 1024 * 1024,
    imageVisionEager: true,
  };
  const config = {
    get: vi.fn().mockReturnValue(configValue),
    getOrThrow: vi.fn().mockReturnValue(configValue),
  };
  const service = new AttachmentsService(
    attachments as never,
    links as never,
    storage,
    queue,
    config,
  );
  return { service, attachments, links, storage, queue };
}

const pdf = (size = 10) =>
  ({
    originalname: 'a.pdf',
    mimetype: 'application/pdf',
    size,
    buffer: Buffer.alloc(size),
  }) as never;

describe('AttachmentsService.upload', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
  });

  it('rejects a disallowed mime type', async () => {
    const exe = {
      originalname: 'x.exe',
      mimetype: 'application/x-msdownload',
      size: 10,
      buffer: Buffer.alloc(10),
    } as never;
    await expect(ctx.service.upload(exe)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects files over the size cap', async () => {
    const big = {
      originalname: 'a.pdf',
      mimetype: 'application/pdf',
      size: 99 * 1024 * 1024,
      buffer: Buffer.alloc(1),
    } as never;
    await expect(ctx.service.upload(big)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('stores bytes, creates a record, and enqueues parsing', async () => {
    const result = await ctx.service.upload(pdf());
    expect(ctx.storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/original$/),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(ctx.queue.add).toHaveBeenCalled();
    expect(result.parseStatus).toBe('pending');
  });

  it('dedupes by checksum without re-storing', async () => {
    ctx.attachments.findByChecksum.mockResolvedValue({
      id: 'existing',
      filename: 'a.pdf',
      mime_type: 'application/pdf',
      size_bytes: 10,
      parse_status: 'parsed',
    });
    const result = await ctx.service.upload(pdf());
    expect(result.id).toBe('existing');
    expect(ctx.storage.put).not.toHaveBeenCalled();
  });
});

describe('AttachmentsService.link', () => {
  it('links an attachment to an owner', async () => {
    const { service, attachments, links } = buildService();
    attachments.findById.mockResolvedValue({ id: 'att-1' });
    await service.link('att-1', 'chat_message', 'msg-1');
    expect(links.link).toHaveBeenCalledWith('att-1', 'chat_message', 'msg-1');
  });

  it('throws NotFoundException for unknown attachment', async () => {
    const { service, attachments } = buildService();
    attachments.findById.mockResolvedValue(null);
    await expect(
      service.link('bad-id', 'chat_message', 'msg-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AttachmentsService.getMetadata', () => {
  it('returns metadata for a known attachment', async () => {
    const { service, attachments } = buildService();
    attachments.findById.mockResolvedValue({ id: 'att-1', filename: 'a.pdf' });
    const result = await service.getMetadata('att-1');
    expect(result.filename).toBe('a.pdf');
  });

  it('throws NotFoundException for unknown attachment', async () => {
    const { service, attachments } = buildService();
    attachments.findById.mockResolvedValue(null);
    await expect(service.getMetadata('bad-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AttachmentsService.getContent', () => {
  it('returns bytes for a stored attachment', async () => {
    const { service, attachments, storage } = buildService();
    attachments.findById.mockResolvedValue({
      id: 'att-1',
      storage_key: 'abc/original',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('x'),
      contentType: 'application/pdf',
    });
    const result = await service.getContent('att-1');
    expect(result.body).toEqual(Buffer.from('x'));
  });

  it('throws NotFoundException when storage_key is empty', async () => {
    const { service, attachments } = buildService();
    attachments.findById.mockResolvedValue({ id: 'att-1', storage_key: '' });
    await expect(service.getContent('att-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AttachmentsService.getParsed', () => {
  it('returns parsed content for a parsed attachment', async () => {
    const { service, attachments, storage } = buildService();
    attachments.findById.mockResolvedValue({
      id: 'att-1',
      parse_status: 'parsed',
      parsed_key: 'abc/parsed.md',
    });
    storage.get.mockResolvedValue({
      body: Buffer.from('# hello'),
      contentType: 'text/markdown',
    });
    const result = await service.getParsed('att-1');
    expect(result.content).toBe('# hello');
    expect(result.status).toBe('parsed');
  });

  it('returns status only when not yet parsed', async () => {
    const { service, attachments } = buildService();
    attachments.findById.mockResolvedValue({
      id: 'att-1',
      parse_status: 'pending',
      parsed_key: null,
    });
    const result = await service.getParsed('att-1');
    expect(result.content).toBeNull();
    expect(result.status).toBe('pending');
  });
});
