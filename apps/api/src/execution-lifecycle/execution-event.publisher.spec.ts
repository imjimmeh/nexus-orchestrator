import { describe, expect, it, vi } from 'vitest';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { EXECUTION_EVENT_TYPES } from './execution-lifecycle.contracts';

describe('ExecutionEventPublisher', () => {
  it('publishes a heartbeat envelope with execution aggregate identity', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.heartbeat('exec-1', { source: 'telemetry' });

    expect(publish).toHaveBeenCalledTimes(1);
    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.heartbeat);
    expect(envelope.aggregateType).toBe('execution');
    expect(envelope.aggregateId).toBe('exec-1');
    expect(typeof envelope.eventId).toBe('string');
    expect(envelope.occurredAt).toBeInstanceOf(Date);
  });

  it('publishes a reaped envelope carrying failure_reason', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.reaped('exec-1', {
      failure_reason: 'idle_timeout',
      error_message: 'no heartbeat for 20m',
    });

    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.reaped);
    expect(envelope.payload.failure_reason).toBe('idle_timeout');
  });

  it('publishes a cancelled envelope carrying failure_reason and error_message', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.cancelled('exec-1', {
      failure_reason: 'parent_terminated',
      error_message: 'parent workflow aborted',
    });

    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.cancelled);
    expect(envelope.aggregateId).toBe('exec-1');
    expect(envelope.payload.failure_reason).toBe('parent_terminated');
    expect(envelope.payload.error_message).toBe('parent workflow aborted');
  });

  it('publishes a paused envelope carrying reason', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.paused('exec-2', { reason: 'graceful_shutdown' });

    expect(publish).toHaveBeenCalledTimes(1);
    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.paused);
    expect(envelope.aggregateType).toBe('execution');
    expect(envelope.aggregateId).toBe('exec-2');
    expect(envelope.payload.reason).toBe('graceful_shutdown');
  });

  it('publishes a resumed envelope carrying via', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.resumed('exec-3', { via: 'rehydrate' });

    expect(publish).toHaveBeenCalledTimes(1);
    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.resumed);
    expect(envelope.aggregateType).toBe('execution');
    expect(envelope.aggregateId).toBe('exec-3');
    expect(envelope.payload.via).toBe('rehydrate');
  });
});
