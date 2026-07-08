import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopedVariableRepository } from './scoped-variable.repository';
import { ScopedVariable } from '../entities/scoped-variable.entity';
import { IsNull, type Repository } from 'typeorm';

function makeTypeormRepoMock() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((x) => x),
    save: vi.fn((x) => Promise.resolve({ id: 'generated-id', ...x })),
    delete: vi.fn(),
  } as unknown as Repository<ScopedVariable>;
}

describe('ScopedVariableRepository', () => {
  let typeorm: Repository<ScopedVariable>;
  let repo: ScopedVariableRepository;

  beforeEach(() => {
    typeorm = makeTypeormRepoMock();
    repo = new ScopedVariableRepository(typeorm);
  });

  it('findGlobals queries rows with NULL scope', async () => {
    await repo.findGlobals();
    expect(typeorm.find).toHaveBeenCalledWith({
      where: { scope_node_id: IsNull() },
    });
  });

  it('findByScopeIds returns empty without a DB call when no ids', async () => {
    const result = await repo.findByScopeIds([]);
    expect(result).toEqual([]);
    expect(typeorm.find).not.toHaveBeenCalled();
  });
});
