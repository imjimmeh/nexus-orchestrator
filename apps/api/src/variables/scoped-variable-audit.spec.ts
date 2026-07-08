import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ScopedVariableRepository } from './database/repositories/scoped-variable.repository';
import type { ScopedVariableAuditRepository } from './database/repositories/scoped-variable-audit.repository';

describe('ScopedVariableRepository audit integration', () => {
  let repo: ScopedVariableRepository;
  const ormRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    create: vi.fn((x) => x),
  };
  const audit: { record: ReturnType<typeof vi.fn> } = { record: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ScopedVariableRepository(ormRepo as never, audit as never);
  });

  it('records an upsert audit with previous + new value', async () => {
    ormRepo.findOne.mockResolvedValue({
      key: 'autonomy.dispatch',
      value: 'auto',
      scope_node_id: 'p-1',
    });
    ormRepo.save.mockResolvedValue({});

    await repo.upsert({
      scopeNodeId: 'p-1',
      key: 'autonomy.dispatch',
      value: 'ask',
      valueType: 'string',
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeNodeId: 'p-1',
        key: 'autonomy.dispatch',
        action: 'upsert',
        previousValue: 'auto',
        newValue: 'ask',
      }),
    );
  });

  it('records a delete audit', async () => {
    ormRepo.findOne.mockResolvedValue({
      key: 'autonomy.dispatch',
      value: 'ask',
      scope_node_id: 'p-1',
    });
    ormRepo.delete.mockResolvedValue({});

    await repo.deleteByKeyAndScope('autonomy.dispatch', 'p-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', previousValue: 'ask' }),
    );
  });
});
