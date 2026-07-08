import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ScopeService } from './scope.service';

describe('ScopeService.getAllowedChildTypes', () => {
  it("resolves the PARENT_CHILD_TYPE_MATRIX row for the node's type", async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'n1', type: 'org' }),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.getAllowedChildTypes('n1')).resolves.toEqual([
      'org',
      'region',
      'team',
      'project',
    ]);
  });

  it('throws NotFoundException when the node does not exist', async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.getAllowedChildTypes('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
