import { describe, expect, it, vi } from 'vitest';
import type { PluginEventDeliveryRepository } from '../database/repositories/plugin-event-delivery.repository';
import type { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import type { PluginPolicyService } from '../plugin-policy.service';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginEventSubscriptionProjectionService } from './plugin-event-subscription-projection.service';
import { PluginEventDeliveryEngineService } from './plugin-event-delivery-engine.service';

function createRegistryEntry() {
  return {
    plugin_id: 'acme.plugin',
    version: '1.0.0',
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    lifecycle_state: 'enabled',
    enabled: true,
    requested_permissions: [],
    granted_permissions: [],
    contributions: [
      {
        id: 'audit-subscription',
        type: 'event.subscription',
        config: { operation: 'handle' },
      },
    ],
    scan_result: { status: 'passed' },
    compatibility_result: { status: 'passed' },
  };
}

function createService(
  overrides: {
    subscriptionProjection?: Partial<PluginEventSubscriptionProjectionService>;
    runtimeManager?: Partial<PluginRuntimeManagerService>;
    policyService?: Partial<PluginPolicyService>;
    registryEntries?: Partial<PluginRegistryEntryRepository>;
    deliveryRepository?: Partial<PluginEventDeliveryRepository>;
  } = {},
) {
  const subscriptionProjection = {
    findMatchingSubscriptions: vi.fn().mockReturnValue([]),
    ...overrides.subscriptionProjection,
  };
  const runtimeManager = {
    deliverEvent: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides.runtimeManager,
  };
  const policyService = {
    decideEventDelivery: vi.fn().mockReturnValue({ allowed: true }),
    ...overrides.policyService,
  };
  const registryEntries = {
    findByPluginIdAndVersion: vi.fn().mockResolvedValue(createRegistryEntry()),
    ...overrides.registryEntries,
  };
  const deliveryRepository = {
    createPending: vi.fn().mockResolvedValue({
      id: 'delivery-1',
      attempt_count: 0,
      max_attempts: 3,
      retry_initial_delay_ms: 1000,
      retry_backoff_multiplier: 2,
      dead_letter_enabled: true,
    }),
    markDelivered: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(null),
    markDeadLettered: vi.fn().mockResolvedValue(null),
    ...overrides.deliveryRepository,
  };

  return {
    service: new PluginEventDeliveryEngineService(
      subscriptionProjection as unknown as PluginEventSubscriptionProjectionService,
      runtimeManager as unknown as PluginRuntimeManagerService,
      policyService as unknown as PluginPolicyService,
      registryEntries as unknown as PluginRegistryEntryRepository,
      deliveryRepository as unknown as PluginEventDeliveryRepository,
    ),
    subscriptionProjection,
    runtimeManager,
    policyService,
    registryEntries,
    deliveryRepository,
  };
}

describe('PluginEventDeliveryEngineService', () => {
  it('delivers to multiple matching subscriptions', async () => {
    const { service, runtimeManager, deliveryRepository } = createService({
      subscriptionProjection: {
        findMatchingSubscriptions: vi.fn().mockReturnValue([
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription',
            deliveryMode: 'non_blocking',
            retry: {
              maxAttempts: 3,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription-2',
            deliveryMode: 'non_blocking',
            retry: {
              maxAttempts: 3,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
        ]),
      },
    });

    const result = await service.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
      correlationId: 'corr-1',
    });

    expect(result.ok).toBe(true);
    expect(result.deliveries).toHaveLength(2);
    expect(deliveryRepository.createPending).toHaveBeenCalledTimes(2);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(2);
    expect(deliveryRepository.markDelivered).toHaveBeenCalledTimes(2);
  });

  it('records policy denial without invoking runtime manager', async () => {
    const { service, runtimeManager, deliveryRepository } = createService({
      subscriptionProjection: {
        findMatchingSubscriptions: vi.fn().mockReturnValue([
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription',
            deliveryMode: 'non_blocking',
            retry: {
              maxAttempts: 3,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
        ]),
      },
      policyService: {
        decideEventDelivery: vi.fn().mockReturnValue({
          allowed: false,
          reasonCode: 'permission_not_granted',
          message: 'Required plugin permission was not granted.',
        }),
      },
    });

    const result = await service.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(result.deliveries).toEqual([
      expect.objectContaining({
        status: 'policy_denied',
        errorCode: 'permission_not_granted',
      }),
    ]);
    expect(deliveryRepository.markFailed).toHaveBeenCalledTimes(1);
    expect(runtimeManager.deliverEvent).not.toHaveBeenCalled();
  });

  it('returns blocking failure when blocking subscriber delivery fails', async () => {
    const { service, deliveryRepository } = createService({
      subscriptionProjection: {
        findMatchingSubscriptions: vi.fn().mockReturnValue([
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription',
            deliveryMode: 'blocking',
            retry: {
              maxAttempts: 3,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
        ]),
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

    const result = await service.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(false);
    expect(result.blockingFailure).toEqual(
      expect.objectContaining({
        status: 'delivery_failed',
        deliveryMode: 'blocking',
        errorCode: 'runtime_timeout',
      }),
    );
    expect(deliveryRepository.markFailed).toHaveBeenCalledTimes(1);
  });

  it('continues after non-blocking runtime failure', async () => {
    const { service, deliveryRepository } = createService({
      subscriptionProjection: {
        findMatchingSubscriptions: vi.fn().mockReturnValue([
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription',
            deliveryMode: 'non_blocking',
            retry: {
              maxAttempts: 3,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
        ]),
      },
      runtimeManager: {
        deliverEvent: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_error',
            message: 'Plugin runtime call failed.',
            retryable: true,
          },
        }),
      },
    });

    const result = await service.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(result.deliveries).toEqual([
      expect.objectContaining({
        status: 'delivery_failed',
        deliveryMode: 'non_blocking',
      }),
    ]);
    expect(deliveryRepository.markFailed).toHaveBeenCalledTimes(1);
  });

  it('dead-letters exhausted failures when policy enables dead-letter mode', async () => {
    const { service, deliveryRepository } = createService({
      subscriptionProjection: {
        findMatchingSubscriptions: vi.fn().mockReturnValue([
          {
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'audit-subscription',
            deliveryMode: 'non_blocking',
            retry: {
              maxAttempts: 1,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
            },
            deadLetter: { enabled: true },
            requiredPermissions: [],
          },
        ]),
      },
      runtimeManager: {
        deliverEvent: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'runtime_error',
            message: 'Plugin runtime call failed.',
            retryable: true,
          },
        }),
      },
      deliveryRepository: {
        createPending: vi.fn().mockResolvedValue({
          id: 'delivery-1',
          attempt_count: 0,
          max_attempts: 1,
          retry_initial_delay_ms: 1000,
          retry_backoff_multiplier: 2,
          dead_letter_enabled: true,
        }),
      },
    });

    await service.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(deliveryRepository.markDeadLettered).toHaveBeenCalledTimes(1);
  });
});
