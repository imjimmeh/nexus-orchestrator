import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ScopeService } from './scope.service';

describe('ScopeService.getNode', () => {
  it('returns the scope node for a known id', async () => {
    const node = { id: 'n1', type: 'org', name: 'Acme', slug: 'acme' };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.getNode('n1')).resolves.toEqual(node);
    expect(nodeRepo.findOneBy).toHaveBeenCalledWith({ id: 'n1' });
  });

  it('throws NotFoundException when the node does not exist', async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.getNode('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
