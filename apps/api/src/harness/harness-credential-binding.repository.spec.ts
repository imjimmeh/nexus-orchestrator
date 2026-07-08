import { describe, it, expect, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { IsNull } from 'typeorm';
import { HarnessCredentialBindingRepository } from './harness-credential-binding.repository';
import type { HarnessCredentialBindingEntity } from './entities/harness-credential-binding.entity';

function makeRepo(): Repository<HarnessCredentialBindingEntity> {
  return {
    findOneBy: vi.fn(),
    find: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };
}

describe('HarnessCredentialBindingRepository', () => {
  it('findBinding queries by exact scope/harness/key', async () => {
    const repo = makeRepo();
    const row = {
      id: 'b1',
      scopeNodeId: null,
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
    } as HarnessCredentialBindingEntity;
    vi.mocked(repo.findOneBy).mockResolvedValue(row);
    const sut = new HarnessCredentialBindingRepository(repo);

    const result = await sut.findBinding(null, 'claude-code', 'anthropic');

    expect(repo.findOneBy).toHaveBeenCalledWith({
      scopeNodeId: IsNull(),
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
    });
    expect(result).toBe(row);
  });

  it('findForScopeChain returns the first binding in scope-id order', async () => {
    const repo = makeRepo();
    const specific = {
      id: 'specific',
      scopeNodeId: 'scope-a',
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
    } as HarnessCredentialBindingEntity;
    const platform = {
      id: 'platform',
      scopeNodeId: null,
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
    } as HarnessCredentialBindingEntity;
    vi.mocked(repo.find).mockResolvedValue([platform, specific]);
    const sut = new HarnessCredentialBindingRepository(repo);

    const result = await sut.findForScopeChain(
      ['scope-a', null],
      'claude-code',
      'anthropic',
    );

    // first id in the supplied order ("scope-a") wins
    expect(result).toBe(specific);
  });

  it('findForScopeChain returns null when no binding matches', async () => {
    const repo = makeRepo();
    vi.mocked(repo.find).mockResolvedValue([]);
    const sut = new HarnessCredentialBindingRepository(repo);

    const result = await sut.findForScopeChain(
      ['scope-a', null],
      'claude-code',
      'anthropic',
    );

    expect(result).toBeNull();
  });

  it('upsert delegates to save', async () => {
    const repo = makeRepo();
    const saved = { id: 'saved' } as HarnessCredentialBindingEntity;
    vi.mocked(repo.save).mockResolvedValue(saved);
    const sut = new HarnessCredentialBindingRepository(repo);

    const result = await sut.upsert({
      scopeNodeId: null,
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
      authType: 'api_key',
      secretId: 's1',
    });

    expect(repo.save).toHaveBeenCalled();
    expect(result).toBe(saved);
  });

  it('remove delegates to delete by id', async () => {
    const repo = makeRepo();
    const sut = new HarnessCredentialBindingRepository(repo);

    await sut.remove('b1');

    expect(repo.delete).toHaveBeenCalledWith({ id: 'b1' });
  });

  it('listForHarness queries by harnessId', async () => {
    const repo = makeRepo();
    const rows = [{ id: 'b1' }] as HarnessCredentialBindingEntity[];
    vi.mocked(repo.find).mockResolvedValue(rows);
    const sut = new HarnessCredentialBindingRepository(repo);

    const result = await sut.listForHarness('claude-code');

    expect(repo.find).toHaveBeenCalledWith({
      where: { harnessId: 'claude-code' },
    });
    expect(result).toBe(rows);
  });
});
