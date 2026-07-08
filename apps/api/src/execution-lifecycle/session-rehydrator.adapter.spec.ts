import { describe, expect, it, vi } from 'vitest';
import { SessionRehydratorAdapter } from './session-rehydrator.adapter';

function buildExecutionRepo(execution: unknown) {
  return { findById: vi.fn().mockResolvedValue(execution) };
}

describe('SessionRehydratorAdapter', () => {
  it('returns false (degrade path) for a known execution', async () => {
    const repo = buildExecutionRepo({ id: 'exec-1', kind: 'workflow_step' });
    const adapter = new SessionRehydratorAdapter(repo as never);

    const result = await adapter.rehydrateAndResume('exec-1');

    expect(result).toBe(false);
    expect(repo.findById).toHaveBeenCalledWith('exec-1');
  });

  it('returns false when the execution is not found in the DB (null)', async () => {
    const repo = buildExecutionRepo(null);
    const adapter = new SessionRehydratorAdapter(repo as never);

    const result = await adapter.rehydrateAndResume('missing-exec');

    expect(result).toBe(false);
    expect(repo.findById).toHaveBeenCalledWith('missing-exec');
  });

  it('does not throw and resolves to false for a chat-kind execution', async () => {
    const repo = buildExecutionRepo({ id: 'exec-3', kind: 'chat' });
    const adapter = new SessionRehydratorAdapter(repo as never);

    await expect(adapter.rehydrateAndResume('exec-3')).resolves.toBe(false);
  });
});
