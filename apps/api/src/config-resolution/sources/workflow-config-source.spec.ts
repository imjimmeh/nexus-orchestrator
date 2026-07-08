import { describe, it, expect, vi } from 'vitest';
import { WorkflowConfigSource } from './workflow-config-source';

describe('WorkflowConfigSource.loadCandidates', () => {
  it('maps workflow rows to ConfigLayerRecord with strategy derived from overrides', async () => {
    const qb = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([
        {
          id: 'r1',
          name: 'wf',
          scope_node_id: null,
          source: 'seeded',
          locked: false,
          overrides: null,
          yaml_definition: 'x',
          base_ref: null,
        },
        {
          id: 'r2',
          name: 'wf',
          scope_node_id: 'team',
          source: 'admin',
          locked: false,
          overrides: { is_active: false },
          yaml_definition: 'x',
          base_ref: null,
        },
      ]),
    };
    const repo = { createQueryBuilder: vi.fn().mockReturnValue(qb) } as any;
    const source = new WorkflowConfigSource(repo);

    const out = await source.loadCandidates('wf', [
      '00000000-0000-0000-0000-000000000000',
      'team',
    ]);

    expect(source.objectType).toBe('workflow');
    expect(out).toHaveLength(2);
    expect(out[0].strategy).toBe('replace');
    expect(out[1].strategy).toBe('merge');
    expect(out[1].overrides).toEqual({ is_active: false });
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('scope_node_id IS NULL OR'),
      expect.objectContaining({ scopeIds: expect.any(Array) }),
    );
  });
});
