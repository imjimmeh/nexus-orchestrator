import { describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeOperationResult } from '../runtime/plugin-runtime.types';
import type { PluginPolicyDecision } from '../plugin-policy.types';
import { PluginEventDeliveryEngineService } from './plugin-event-delivery-engine.service';
import { PluginEventDeliveryWorkerService } from './plugin-event-delivery-worker.service';

describe('Plugin event bus integration', () => {
  it('delivers an approved subscribed event to runtime', async () => {
    const subscriptionProjection = {
      findMatchingSubscriptions: vi.fn().mockReturnValue([
        {
          pluginId: 'acme.plugin',
          version: '1.0.0',
          contributionId: 'run-events',
          operation: 'handle_event',
          topics: ['workflow.run.completed.v1'],
          deliveryMode: 'non_blocking',
          retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2 },
          deadLetter: { enabled: true },
          requiredPermissions: [],
          contribution: {
            id: 'run-events',
            type: 'event.subscription',
            displayName: 'Workflow Run Events',
            config: {
              topics: ['workflow.run.completed.v1'],
              operation: 'handle_event',
            },
          },
        },
      ]),
    };
    const runtimeManager = {
      deliverEvent: vi
        .fn()
        .mockResolvedValue({ ok: true } satisfies PluginRuntimeOperationResult),
    };
    const policyService = {
      decideEventDelivery: vi
        .fn()
        .mockReturnValue({ allowed: true } satisfies PluginPolicyDecision),
    };
    const registryEntries = {
      findByPluginIdAndVersion: vi.fn().mockResolvedValue({
        plugin_id: 'acme.plugin',
        version: '1.0.0',
        trust_level: 'local_trusted',
        isolation_mode: 'worker_process',
        lifecycle_state: 'enabled',
        enabled: true,
        requested_permissions: [],
        granted_permissions: [],
        contributions: [
          {
            id: 'run-events',
            type: 'event.subscription',
            displayName: 'Workflow Run Events',
            config: {
              topics: ['workflow.run.completed.v1'],
              operation: 'handle_event',
            },
          },
          {
            id: 'audit-endpoint',
            type: 'capability.endpoint',
            displayName: 'Audit Endpoint',
            config: {
              inputSchema: { type: 'object' },
              operation: 'invoke_audit',
              visibility: ['workflow'],
            },
          },
        ],
        scan_result: { status: 'passed' },
        compatibility_result: { status: 'passed' },
      }),
    };

    const created = {
      id: 'delivery-1',
      attempt_count: 0,
      max_attempts: 3,
      retry_initial_delay_ms: 1000,
      retry_backoff_multiplier: 2,
      dead_letter_enabled: true,
    };
    const deliveryRepository = {
      createPending: vi.fn().mockResolvedValue(created),
      markDelivered: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markDeadLettered: vi.fn().mockResolvedValue(undefined),
    };

    const engine = new PluginEventDeliveryEngineService(
      subscriptionProjection as never,
      runtimeManager as never,
      policyService as never,
      registryEntries as never,
      deliveryRepository as never,
    );

    const result = await engine.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { runId: 'run-1', scopeId: 'scope-1' },
      occurredAt: '2026-05-18T12:00:00.000Z',
      correlationId: 'corr-1',
    });

    expect(result.ok).toBe(true);
    expect(result.deliveries).toHaveLength(1);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(1);
    expect(deliveryRepository.markDelivered).toHaveBeenCalledWith(
      'delivery-1',
      expect.any(Date),
    );
  });

  it('does not invoke runtime when policy denies subscription delivery', async () => {
    const subscriptionProjection = {
      findMatchingSubscriptions: vi.fn().mockReturnValue([
        {
          pluginId: 'acme.plugin',
          version: '1.0.0',
          contributionId: 'run-events',
          operation: 'handle_event',
          topics: ['workflow.run.completed.v1'],
          deliveryMode: 'non_blocking',
          retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2 },
          deadLetter: { enabled: true },
          requiredPermissions: ['internal_capability:plugin.events.basic'],
          contribution: {
            id: 'run-events',
            type: 'event.subscription',
            displayName: 'Workflow Run Events',
            config: {
              topics: ['workflow.run.completed.v1'],
              operation: 'handle_event',
            },
          },
        },
      ]),
    };
    const runtimeManager = {
      deliverEvent: vi.fn(),
    };
    const policyService = {
      decideEventDelivery: vi.fn().mockReturnValue({
        allowed: false,
        reasonCode: 'permission_not_granted',
        message: 'Required plugin permission was not granted.',
      } satisfies PluginPolicyDecision),
    };
    const registryEntries = {
      findByPluginIdAndVersion: vi.fn().mockResolvedValue({
        plugin_id: 'acme.plugin',
        version: '1.0.0',
        trust_level: 'local_trusted',
        isolation_mode: 'worker_process',
        lifecycle_state: 'enabled',
        enabled: true,
        requested_permissions: [],
        granted_permissions: [],
        contributions: [],
        scan_result: { status: 'passed' },
        compatibility_result: { status: 'passed' },
      }),
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
      markDelivered: vi.fn(),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markDeadLettered: vi.fn(),
    };

    const engine = new PluginEventDeliveryEngineService(
      subscriptionProjection as never,
      runtimeManager as never,
      policyService as never,
      registryEntries as never,
      deliveryRepository as never,
    );

    const result = await engine.deliver({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { runId: 'run-1' },
      occurredAt: '2026-05-18T12:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(runtimeManager.deliverEvent).not.toHaveBeenCalled();
    expect(deliveryRepository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'permission_not_granted',
      }),
    );
  });

  it('dead-letters exhausted retryable failures in worker processing', async () => {
    const runtimeManager = {
      deliverEvent: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'runtime_timeout',
          message: 'Plugin runtime timed out with internal detail',
          retryable: true,
        },
      } satisfies PluginRuntimeOperationResult),
    };

    const due = {
      id: 'delivery-1',
      plugin_id: 'acme.plugin',
      plugin_version: '1.0.0',
      contribution_id: 'run-events',
      topic: 'workflow.run.completed.v1',
      event_name: 'workflow.run.completed.v1',
      payload: { runId: 'run-1' },
      correlation_id: 'corr-1',
      delivery_mode: 'non_blocking',
      status: 'failed',
      attempt_count: 1,
      max_attempts: 2,
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
    };
    const deliveryRepository = {
      claimDueDeliveries: vi.fn().mockResolvedValue([due]),
      markDelivered: vi.fn(),
      markFailed: vi.fn(),
      markDeadLettered: vi.fn().mockResolvedValue(undefined),
    };

    const worker = new PluginEventDeliveryWorkerService(
      deliveryRepository as never,
      runtimeManager as never,
    );

    const processed = await worker.processDueDeliveries(10);

    expect(processed).toBe(1);
    expect(deliveryRepository.markDeadLettered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delivery-1',
        errorCode: 'runtime_timeout',
      }),
    );
  });
});
