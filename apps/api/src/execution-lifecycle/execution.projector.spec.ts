import { describe, expect, it, vi } from 'vitest';
import { ExecutionProjector } from './execution.projector';
import { EXECUTION_EVENT_TYPES } from './execution-lifecycle.contracts';

function fakeBus() {
  const handlers = new Map<string, (e: unknown) => Promise<void>>();
  return {
    handlers,
    on: vi.fn((type: string, h: (e: unknown) => Promise<void>) =>
      handlers.set(type, h),
    ),
    fire: (type: string, e: unknown) => handlers.get(type)!(e),
  };
}

function fakeRepo() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    applyTransition: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ExecutionProjector', () => {
  it('creates a row on execution.created', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.created, {
      aggregateId: 'e1',
      payload: { kind: 'subagent', workflow_run_id: 'r1' },
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', kind: 'subagent', state: 'pending' }),
    );
  });

  it('applies a reaped transition with failure reason', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.reaped, {
      aggregateId: 'e1',
      payload: { failure_reason: 'idle_timeout', error_message: 'x' },
    });

    expect(repo.applyTransition).toHaveBeenCalledWith('e1', 'reaped', {
      failure_reason: 'idle_timeout',
      error_message: 'x',
    });
  });

  it('applies a cancelled transition with failure reason', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.cancelled, {
      aggregateId: 'e1',
      payload: {
        failure_reason: 'parent_terminated',
        error_message: 'parent aborted',
      },
    });

    expect(repo.applyTransition).toHaveBeenCalledWith('e1', 'cancelled', {
      failure_reason: 'parent_terminated',
      error_message: 'parent aborted',
    });
  });

  it('applies a provisioning transition on execution.provisioning', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.provisioning, {
      aggregateId: 'e1',
      payload: {},
    });

    expect(repo.applyTransition).toHaveBeenCalledWith('e1', 'provisioning');
  });

  it('walks completing -> completed on execution.completed', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.completed, {
      aggregateId: 'e1',
      payload: {},
    });

    const transitions = repo.applyTransition.mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(transitions).toEqual(['completing', 'completed']);
  });

  it('refreshes last_heartbeat_at on execution.heartbeat', async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.heartbeat, {
      aggregateId: 'e1',
      payload: { source: 'telemetry' },
    });

    expect(repo.applyTransition).toHaveBeenCalledWith(
      'e1',
      'running',
      expect.objectContaining({ last_heartbeat_at: expect.any(Date) }),
    );
  });
});
