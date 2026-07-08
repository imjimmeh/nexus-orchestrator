import { describe, expect, it, vi } from 'vitest';
import type { PluginEventDeliveryEngineService } from './plugin-event-delivery-engine.service';
import { PluginEventPublisherService } from './plugin-event-publisher.service';

function createService(
  overrides: Partial<PluginEventDeliveryEngineService> = {},
) {
  const deliveryEngine = {
    deliver: vi.fn().mockResolvedValue({ ok: true, deliveries: [] }),
    ...overrides,
  };

  return {
    service: new PluginEventPublisherService(
      deliveryEngine as unknown as PluginEventDeliveryEngineService,
    ),
    deliveryEngine,
  };
}

describe('PluginEventPublisherService', () => {
  it('publishes approved topics through delivery engine', async () => {
    const { service, deliveryEngine } = createService();

    const result = await service.publish({
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
      correlationId: 'corr-1',
    });

    expect(result).toEqual({
      ok: true,
      topic: 'workflow.run.completed.v1',
      correlationId: 'corr-1',
      deliveries: [],
    });
    expect(deliveryEngine.deliver).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown topics before delivery', async () => {
    const { service, deliveryEngine } = createService();

    const result = await service.publish({
      topic: 'workflow.run.cancelled.v1',
      eventName: 'workflow.run.cancelled.v1',
      payload: { scopeId: 'scope-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(result).toEqual({
      ok: false,
      topic: 'workflow.run.cancelled.v1',
      deliveries: [],
      errorCode: 'event_topic_not_approved',
    });
    expect(deliveryEngine.deliver).not.toHaveBeenCalled();
  });

  it('returns success when no subscriptions match', async () => {
    const { service } = createService({
      deliver: vi.fn().mockResolvedValue({ ok: true, deliveries: [] }),
    });

    const result = await service.publish({
      topic: 'tool.invoked.v1',
      eventName: 'tool.invoked.v1',
      payload: { invocationId: 'invocation-1' },
      occurredAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    expect(result.deliveries).toEqual([]);
  });

  it('builds and publishes workflow run lifecycle events', async () => {
    const { service, deliveryEngine } = createService();

    await service.publishWorkflowRunLifecycleEvent({
      runId: 'run-1',
      status: 'started',
      eventName: 'workflow.run.started.v1',
      correlationId: 'corr-1',
      occurredAt: '2026-05-18T12:00:00.000Z',
      scopeId: 'scope-1',
      contextId: 'context-1',
    });

    expect(deliveryEngine.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'workflow.run.started.v1',
        eventName: 'workflow.run.started.v1',
        correlationId: 'corr-1',
        payload: expect.objectContaining({
          runId: 'run-1',
          status: 'started',
          eventName: 'workflow.run.started.v1',
        }),
      }),
    );
  });

  it('builds and publishes tool invocation events', async () => {
    const { service, deliveryEngine } = createService();

    await service.publishToolInvokedEvent({
      toolName: 'plugin:acme.plugin:summarize',
      invocationId: 'inv-1',
      pluginId: 'acme.plugin',
      contributionId: 'summarize',
      version: '1.0.0',
      correlationId: 'corr-tool-1',
    });

    expect(deliveryEngine.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'tool.invoked.v1',
        payload: expect.objectContaining({
          toolName: 'plugin:acme.plugin:summarize',
          invocationId: 'inv-1',
          pluginId: 'acme.plugin',
        }),
      }),
    );
  });

  it('builds and publishes memory recorded events', async () => {
    const { service, deliveryEngine } = createService();

    await service.publishMemoryRecordedEvent({
      segmentId: 'segment-1',
      entityType: 'User',
      entityId: 'u-1',
      memoryType: 'fact',
      correlationId: 'corr-memory-1',
    });

    expect(deliveryEngine.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'memory.recorded.v1',
        payload: expect.objectContaining({
          segmentId: 'segment-1',
          entityType: 'User',
          entityId: 'u-1',
          memoryType: 'fact',
        }),
      }),
    );
  });
});
