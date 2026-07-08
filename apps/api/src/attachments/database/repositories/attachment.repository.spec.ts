import { describe, expect, it, vi } from 'vitest';
import { AttachmentRepository } from './attachment.repository';

function buildRepo() {
  const typeorm = {
    findOne: vi.fn(),
    create: vi.fn((d) => d),
    save: vi.fn((d) => Promise.resolve({ id: 'att-1', ...d })),
    update: vi.fn(),
  };
  return { repo: new AttachmentRepository(typeorm), typeorm };
}

describe('AttachmentRepository', () => {
  it('finds an existing attachment by checksum (dedupe)', async () => {
    const { repo, typeorm } = buildRepo();
    typeorm.findOne.mockResolvedValue({ id: 'att-1', checksum: 'abc' });
    const found = await repo.findByChecksum('abc');
    expect(found?.id).toBe('att-1');
    expect(typeorm.findOne).toHaveBeenCalledWith({
      where: { checksum: 'abc' },
    });
  });

  it('creates an attachment', async () => {
    const { repo } = buildRepo();
    const created = await repo.create({ filename: 'a.pdf', checksum: 'x' });
    expect(created.id).toBe('att-1');
  });

  it('finds by id', async () => {
    const { repo, typeorm } = buildRepo();
    typeorm.findOne.mockResolvedValue({ id: 'att-1' });
    const found = await repo.findById('att-1');
    expect(found?.id).toBe('att-1');
  });
});
