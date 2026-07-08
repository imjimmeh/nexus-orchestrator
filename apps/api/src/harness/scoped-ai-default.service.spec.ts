import { describe, it, expect, vi } from 'vitest';
import { ScopedAiDefaultService } from './scoped-ai-default.service';

describe('ScopedAiDefaultService', () => {
  it('getForScope delegates to the repository', async () => {
    const repo = {
      getForScope: vi.fn(async () => ({ harnessId: 'pi' })),
      upsertForScope: vi.fn(),
    };
    const svc = new ScopedAiDefaultService(repo as never);
    expect(await svc.getForScope('scope-a')).toEqual({ harnessId: 'pi' });
    expect(repo.getForScope).toHaveBeenCalledWith('scope-a');
  });

  it('setForScope delegates to repo.upsertForScope', async () => {
    const repo = {
      getForScope: vi.fn(),
      upsertForScope: vi.fn(async () => ({ harnessId: 'claude-code' })),
    };
    const svc = new ScopedAiDefaultService(repo as never);
    await svc.setForScope('scope-a', { harnessId: 'claude-code' });
    expect(repo.upsertForScope).toHaveBeenCalledWith('scope-a', {
      harnessId: 'claude-code',
    });
  });
});
