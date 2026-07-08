import { describe, expect, it, vi } from 'vitest';
import type { PluginEventDeliveryRepository } from '../database/repositories/plugin-event-delivery.repository';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginEventDeliveryWorkerService } from './plugin-event-delivery-worker.service';

function createDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    plugin_id: 'acme.plugin',
    plugin_version: '1.0.0',
    contribution_id: 'audit-subscription',
    topic: 'workflow.run.completed.v1',
    event_name: 'workflow.run.completed.v1',
    payload: { scopeId: 'scope-1' },
    correlation_id: 'corr-1',
    delivery_mode: 'non_blocking',
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    retry_initial_delay_ms: 1000,
    retry_backoff_multiplier: 2,
    dead_letter_enabled: true,
    next_attempt_at: new Date('2026-05-18T12:00:00.000Z'),
    delivered_at: null,
    error_code: null,
    error_message: null,
    error_metadata: null,
    created_at: new Date('2026-05-18T12:00:00.000Z'),
    updated_at: new Date('2026-05-18T12:00:00.000Z'),
    ...overrides,
  };
}

function createService(
  overrides: {
    repository?: Partial<PluginEventDeliveryRepository>;
    runtimeManager?: Partial<PluginRuntimeManagerService>;
  } = {},
) {
  const repository = {
    claimDueDeliveries: vi.fn().mockResolvedValue([]),
    markDelivered: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(null),
    markDeadLettered: vi.fn().mockResolvedValue(null),
    ...overrides.repository,
  };
  const runtimeManager = {
    deliverEvent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides.runtimeManager,
  };

  return {
    service: new PluginEventDeliveryWorkerService(
      repository as unknown as PluginEventDeliveryRepository,
      runtimeManager as unknown as PluginRuntimeManagerService,
    ),
    repository,
    runtimeManager,
  };
}

describe('PluginEventDeliveryWorkerService', () => {
  it('claims due deliveries and marks successful retries as delivered', async () => {
    const { service, repository, runtimeManager } = createService({
      repository: {
        claimDueDeliveries: vi.fn().mockResolvedValue([createDelivery()]),
      },
    });

    const processed = await service.processDueDeliveries(10);

    expect(processed).toBe(1);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(1);
    expect(repository.markDelivered).toHaveBeenCalledTimes(1);
  });

  it('schedules retry with backoff for retryable failures', async () => {
    const { service, repository } = createService({
      repository: {
        claimDueDeliveries: vi
          .fn()
          .mockResolvedValue([createDelivery({ attempt_count: 1 })]),
      },
      runtimeManager: {
        deliverEvent: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_timeout',
            message: 'Plugin runtime call timed out.',
            retryable: true,
          },
        }),
      },
    });

    await service.processDueDeliveries(10);

    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        errorCode: 'runtime_timeout',
        incrementAttemptCount: true,
        nextAttemptAt: expect.any(Date),
      }),
    );
  });

  it('dead-letters exhausted deliveries', async () => {
    const { service, repository } = createService({
      repository: {
        claimDueDeliveries: vi
          .fn()
          .mockResolvedValue([
            createDelivery({ attempt_count: 2, max_attempts: 3 }),
          ]),
      },
      runtimeManager: {
        deliverEvent: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_error',
            message: 'Runtime crashed.',
            retryable: true,
          },
        }),
      },
    });

    await service.processDueDeliveries(10);

    expect(repository.markDeadLettered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        errorCode: 'runtime_error',
      }),
    );
  });

  it('keeps exhausted failures observable when dead-letter is disabled', async () => {
    const { service, repository } = createService({
      repository: {
        claimDueDeliveries: vi.fn().mockResolvedValue([
          createDelivery({
            attempt_count: 2,
            max_attempts: 3,
            dead_letter_enabled: false,
          }),
        ]),
      },
      runtimeManager: {
        deliverEvent: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_error',
            message: 'Runtime crashed.',
            retryable: true,
          },
        }),
      },
    });

    await service.processDueDeliveries(10);

    expect(repository.markDeadLettered).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        errorCode: 'runtime_error',
        incrementAttemptCount: true,
      }),
    );
  });
});
