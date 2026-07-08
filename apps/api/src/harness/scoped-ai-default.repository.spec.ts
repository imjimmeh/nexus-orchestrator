import { describe, it, expect, vi } from 'vitest';
import { In, IsNull } from 'typeorm';
import { ScopedAiDefaultRepository } from './scoped-ai-default.repository';
import type { ScopedAiDefaultEntity } from './entities/scoped-ai-default.entity';

/** Resolves the actual scope key from a findOneBy/findBy where clause, handling IsNull(). */
function resolveScopeNodeId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  // TypeORM FindOperator for IS NULL has type "isNull"
  if (
    typeof value === 'object' &&
    (value as { type?: string }).type === 'isNull'
  ) {
    return null;
  }
  return value as string;
}

function makeFakeRepo(rows: Partial<ScopedAiDefaultEntity>[] = []) {
  const store = [...rows];
  return {
    store,
    findOneBy: vi.fn(async (where: Record<string, unknown>) => {
      const scope = resolveScopeNodeId(where.scopeNodeId);
      return store.find((r) => (r.scopeNodeId ?? null) === scope) ?? null;
    }),
    findBy: vi.fn(async (_where: Record<string, unknown>) =>
      store.filter((r) => r.scopeNodeId != null),
    ),
    save: vi.fn(async (e: Partial<ScopedAiDefaultEntity>) => {
      const idx = store.findIndex(
        (r) => (r.scopeNodeId ?? null) === (e.scopeNodeId ?? null),
      );
      if (idx >= 0) store[idx] = { ...store[idx], ...e };
      else store.push({ id: 'new-id', ...e });
      return e as ScopedAiDefaultEntity;
    }),
  };
}

describe('ScopedAiDefaultRepository', () => {
  it('getForScope(null) reads the platform row', async () => {
    const fake = makeFakeRepo([{ scopeNodeId: null, harnessId: 'pi' }]);
    const repo = new ScopedAiDefaultRepository(fake);
    const row = await repo.getForScope(null);
    expect(fake.findOneBy).toHaveBeenCalledWith({ scopeNodeId: IsNull() });
    expect(row?.harnessId).toBe('pi');
  });

  it('getForScope(id) reads a scoped row', async () => {
    const fake = makeFakeRepo([
      { scopeNodeId: 'scope-a', harnessId: 'claude-code' },
    ]);
    const repo = new ScopedAiDefaultRepository(fake);
    const row = await repo.getForScope('scope-a');
    expect(row?.harnessId).toBe('claude-code');
  });

  it('upsertForScope merges onto an existing row (find-then-save)', async () => {
    const fake = makeFakeRepo([
      { scopeNodeId: 'scope-a', harnessId: 'pi', modelName: 'gpt-x' },
    ]);
    const repo = new ScopedAiDefaultRepository(fake);
    await repo.upsertForScope('scope-a', { harnessId: 'claude-code' });
    expect(fake.findOneBy).toHaveBeenCalledWith({ scopeNodeId: 'scope-a' });
    expect(fake.save).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeNodeId: 'scope-a',
        harnessId: 'claude-code',
        modelName: 'gpt-x',
      }),
    );
  });

  it('upsertForScope(null, ...) creates the single platform row when none exists', async () => {
    const fake = makeFakeRepo([]);
    const repo = new ScopedAiDefaultRepository(fake);
    await repo.upsertForScope(null, { harnessId: 'pi' });
    expect(fake.save).toHaveBeenCalledWith(
      expect.objectContaining({ scopeNodeId: null, harnessId: 'pi' }),
    );
  });

  it('findForScopeIds queries non-null scope ids with In(...)', async () => {
    const fake = makeFakeRepo([
      { scopeNodeId: 'scope-a', harnessId: 'pi' },
      { scopeNodeId: null, harnessId: 'claude-code' },
    ]);
    const repo = new ScopedAiDefaultRepository(fake);
    const rows = await repo.findForScopeIds(['scope-a', 'scope-b']);
    expect(fake.findBy).toHaveBeenCalledWith({
      scopeNodeId: In(['scope-a', 'scope-b']),
    });
    expect(rows.every((r) => r.scopeNodeId != null)).toBe(true);
  });

  it('findForScopeIds returns [] for an empty id list (no query)', async () => {
    const fake = makeFakeRepo([]);
    const repo = new ScopedAiDefaultRepository(fake);
    expect(await repo.findForScopeIds([])).toEqual([]);
    expect(fake.findBy).not.toHaveBeenCalled();
  });
});
