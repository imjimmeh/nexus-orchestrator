import { beforeEach, describe, expect, it } from 'vitest';
import { PluginRuntimeHealthService } from './plugin-runtime-health.service';

describe('PluginRuntimeHealthService', () => {
  let service: PluginRuntimeHealthService;

  beforeEach(() => {
    service = new PluginRuntimeHealthService();
  });

  it('reports startup, health check, pending requests, and shutdown without raw payloads', () => {
    const startedAt = new Date('2026-05-18T10:00:00.000Z');
    const checkedAt = new Date('2026-05-18T10:01:00.000Z');

    service.recordStartup({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      occurredAt: startedAt,
    });
    service.recordRequestStarted({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    service.recordHealthCheck({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      healthy: true,
      occurredAt: checkedAt,
      details: { token: 'secret-token', queueDepth: 2 },
    });

    expect(
      service.getRuntimeHealthSummary({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
      }),
    ).toEqual({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      status: 'healthy',
      lastHealthCheckAt: checkedAt,
      pendingRequests: 1,
      crashLooping: false,
    });

    service.recordRequestFinished({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    service.recordShutdown({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });

    expect(
      service.getRuntimeHealthSummary({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
      }),
    ).toEqual({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      status: 'stopped',
      lastHealthCheckAt: checkedAt,
      pendingRequests: 0,
      crashLooping: false,
    });

    expect(
      JSON.stringify(service.getAllRuntimeHealthSummaries()),
    ).not.toContain('secret-token');
  });

  it('reports sanitized errors and crash-loop state', () => {
    const failedAt = new Date('2026-05-18T10:02:00.000Z');

    service.recordError({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'container',
      code: 'container_crashed',
      message: 'raw docker output token=secret-token',
      occurredAt: failedAt,
    });
    service.recordCrashLoop({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'container',
      crashCount: 3,
      quarantined: true,
    });

    expect(
      service.getRuntimeHealthSummary({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'container',
      }),
    ).toEqual({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'container',
      status: 'crashed',
      lastError: {
        code: 'container_crashed',
        message: 'Plugin runtime call failed.',
        occurredAt: failedAt,
      },
      pendingRequests: 0,
      crashLooping: true,
      crashCount: 3,
      quarantined: true,
    });

    expect(
      JSON.stringify(service.getAllRuntimeHealthSummaries()),
    ).not.toContain('secret-token');
  });
});
