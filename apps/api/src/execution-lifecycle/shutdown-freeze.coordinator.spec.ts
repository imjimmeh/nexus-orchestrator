import { describe, expect, it, vi } from 'vitest';
import { ShutdownFreezeCoordinator } from './shutdown-freeze.coordinator';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';

function build() {
  const lifecycle = new ServiceLifecycleStateService();
  lifecycle.markRunning();
  const candidates = [
    { id: 'e1', container_id: 'c1' },
    { id: 'e2', container_id: 'c2' },
  ];
  const repo = {
    findFreezeCandidates: vi.fn().mockResolvedValue(candidates),
    markFrozen: vi.fn().mockResolvedValue(undefined),
  };
  const freezer = { freezeContainer: vi.fn().mockResolvedValue(undefined) };
  const publisher = { paused: vi.fn().mockResolvedValue(undefined) };
  const workers = { pauseAll: vi.fn().mockResolvedValue(undefined) };
  const coordinator = new ShutdownFreezeCoordinator(
    lifecycle,
    repo as never,
    freezer,
    publisher as never,
    workers,
  );
  return { coordinator, lifecycle, repo, freezer, publisher, workers };
}

describe('ShutdownFreezeCoordinator', () => {
  it('drains workers, freezes every candidate container, and marks them frozen', async () => {
    const { coordinator, lifecycle, repo, freezer, publisher, workers } =
      build();
    await coordinator.onApplicationShutdown('SIGTERM');
    expect(lifecycle.phase).toBe('draining');
    expect(workers.pauseAll).toHaveBeenCalledTimes(1);
    expect(freezer.freezeContainer).toHaveBeenCalledWith('c1');
    expect(freezer.freezeContainer).toHaveBeenCalledWith('c2');
    expect(repo.markFrozen).toHaveBeenCalledTimes(2);
    expect(publisher.paused).toHaveBeenCalledTimes(2);
  });

  it('does not fail the shutdown when one container pause errors', async () => {
    const { coordinator, freezer, repo } = build();
    freezer.freezeContainer.mockRejectedValueOnce(new Error('docker down'));
    await expect(
      coordinator.onApplicationShutdown('SIGTERM'),
    ).resolves.toBeUndefined();
    expect(repo.markFrozen).toHaveBeenCalledTimes(1);
  });

  it('breaks out of the freeze loop without freezing any container when the budget is already exhausted', async () => {
    const { coordinator, freezer, repo } = build();
    // Drive Date.now() past the deadline on the first loop check.
    // The coordinator sets deadline = pausedAt.getTime() + budgetMs (default 20000ms).
    // Returning a value far in the future ensures Date.now() > deadline immediately.
    const dateSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 999_999_999);
    try {
      await coordinator.onApplicationShutdown('SIGTERM');
      expect(freezer.freezeContainer).not.toHaveBeenCalled();
      expect(repo.markFrozen).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
    }
  });
});
