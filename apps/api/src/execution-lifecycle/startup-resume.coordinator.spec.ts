import { describe, expect, it, vi } from 'vitest';
import { StartupResumeCoordinator } from './startup-resume.coordinator';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';

function build(
  states: Record<string, 'paused' | 'running' | 'stopped' | 'missing'>,
) {
  const lifecycle = new ServiceLifecycleStateService();
  const frozen = Object.keys(states).map((id) => ({
    id,
    container_id: `cont-${id}`,
    workflow_run_id: `run-${id}`,
  }));
  const repo = {
    findFrozen: vi.fn().mockResolvedValue(frozen),
    clearFrozen: vi.fn().mockResolvedValue(undefined),
    applyTransition: vi.fn().mockResolvedValue(undefined),
  };
  const resumer = {
    getContainerRuntimeState: vi.fn((cid: string) =>
      Promise.resolve(states[cid.replace('cont-', '')]),
    ),
    resumeContainer: vi.fn().mockResolvedValue(undefined),
  };
  const rehydrator = { rehydrateAndResume: vi.fn().mockResolvedValue(true) };
  const publisher = { resumed: vi.fn().mockResolvedValue(undefined) };
  const coordinator = new StartupResumeCoordinator(
    lifecycle,
    repo as never,
    resumer,
    rehydrator,
    publisher as never,
  );
  return { coordinator, lifecycle, repo, resumer, rehydrator, publisher };
}

describe('StartupResumeCoordinator', () => {
  it('unpauses present containers, clears frozen, marks RUNNING', async () => {
    const { coordinator, lifecycle, repo, resumer, publisher } = build({
      a: 'paused',
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).toHaveBeenCalledWith('cont-a');
    expect(repo.clearFrozen).toHaveBeenCalledWith('a', expect.any(Date));
    expect(publisher.resumed).toHaveBeenCalledWith('a', { via: 'unpause' });
    expect(lifecycle.phase).toBe('running');
    expect(coordinator.lastResumeSummary.resumed).toBe(1);
  });

  it('falls back to rehydrate when the container is gone', async () => {
    const { coordinator, resumer, rehydrator, publisher } = build({
      b: 'missing',
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).not.toHaveBeenCalled();
    expect(rehydrator.rehydrateAndResume).toHaveBeenCalledWith('b');
    expect(publisher.resumed).toHaveBeenCalledWith('b', { via: 'rehydrate' });
  });

  it('unpauses a running container via the unpause path', async () => {
    const { coordinator, resumer, rehydrator, publisher } = build({
      c: 'running',
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).toHaveBeenCalledWith('cont-c');
    expect(rehydrator.rehydrateAndResume).not.toHaveBeenCalled();
    expect(publisher.resumed).toHaveBeenCalledWith('c', { via: 'unpause' });
    expect(coordinator.lastResumeSummary.resumed).toBe(1);
  });

  it('routes a stopped container to rehydrate, not unpause', async () => {
    const { coordinator, resumer, rehydrator, publisher } = build({
      d: 'stopped',
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).not.toHaveBeenCalled();
    expect(rehydrator.rehydrateAndResume).toHaveBeenCalledWith('d');
    expect(publisher.resumed).toHaveBeenCalledWith('d', { via: 'rehydrate' });
    expect(coordinator.lastResumeSummary.resumed).toBe(1);
  });

  it('marks execution as failed and clears frozen if container is missing and rehydrate fails', async () => {
    const { coordinator, repo, rehydrator, publisher } = build({
      e: 'missing',
    });
    rehydrator.rehydrateAndResume.mockResolvedValue(false);
    await coordinator.onApplicationBootstrap();
    expect(rehydrator.rehydrateAndResume).toHaveBeenCalledWith('e');
    expect(repo.clearFrozen).toHaveBeenCalledWith('e', expect.any(Date));
    expect(repo.applyTransition).toHaveBeenCalledWith('e', 'failed', {
      failure_reason: 'container_lost',
      error_message:
        'Could not resume execution: container missing and no rehydratable session',
    });
    expect(publisher.resumed).not.toHaveBeenCalled();
    expect(coordinator.lastResumeSummary.failed).toBe(1);
  });
});
