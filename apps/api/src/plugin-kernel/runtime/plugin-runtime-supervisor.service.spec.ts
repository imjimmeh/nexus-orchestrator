import type { PluginIsolationMode } from '@nexus/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginLifecycleService } from '../plugin-lifecycle.service';
import { PluginRuntimeSupervisorService } from './plugin-runtime-supervisor.service';

type MockPluginLifecycleService = {
  quarantinePlugin: ReturnType<typeof vi.fn>;
};

const baseCrash = {
  pluginId: 'com.acme.workflow-tools',
  version: '1.2.3',
  mode: 'worker_process' satisfies PluginIsolationMode,
} as const;

describe('PluginRuntimeSupervisorService', () => {
  let lifecycle: MockPluginLifecycleService;
  let service: PluginRuntimeSupervisorService;

  beforeEach(() => {
    lifecycle = {
      quarantinePlugin: vi.fn().mockResolvedValue({ id: 'entry-1' }),
    };
    service = new PluginRuntimeSupervisorService(
      lifecycle as unknown as PluginLifecycleService,
    );
  });

  it('does not quarantine while crashes remain below the threshold', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const result = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    expect(result).toEqual({ quarantined: false, crashCount: 2 });
    expect(lifecycle.quarantinePlugin).not.toHaveBeenCalled();
  });

  it('quarantines once when the crash-loop threshold is reached', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    const result = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:02:00.000Z'),
      rawError: new Error('token=secret ipcPayload={"env":"SECRET"}'),
    });
    const repeated = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:03:00.000Z'),
    });

    expect(result).toEqual({ quarantined: true, crashCount: 3 });
    expect(repeated).toEqual({ quarantined: true, crashCount: 4 });
    expect(lifecycle.quarantinePlugin).toHaveBeenCalledTimes(1);
    expect(lifecycle.quarantinePlugin).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'plugin-runtime-supervisor',
      reason:
        'Plugin runtime entered a crash loop in worker_process isolation mode.',
    });
    expect(JSON.stringify(lifecycle.quarantinePlugin.mock.calls)).not.toContain(
      'secret',
    );
    expect(JSON.stringify(lifecycle.quarantinePlugin.mock.calls)).not.toContain(
      'ipcPayload',
    );
  });

  it('retries quarantine on later threshold events when the first quarantine attempt fails', async () => {
    lifecycle.quarantinePlugin
      .mockRejectedValueOnce(new Error('database unavailable token=secret'))
      .mockResolvedValueOnce({ id: 'entry-1' });

    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    await expect(
      service.recordRuntimeCrash({
        ...baseCrash,
        occurredAt: new Date('2026-01-01T00:02:00.000Z'),
      }),
    ).rejects.toThrow('database unavailable');

    const retry = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:03:00.000Z'),
    });

    expect(retry).toEqual({ quarantined: true, crashCount: 4 });
    expect(lifecycle.quarantinePlugin).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(lifecycle.quarantinePlugin.mock.calls)).not.toContain(
      'secret',
    );
  });

  it('ignores crash events outside the bounded window', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    const result = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:11:00.001Z'),
    });

    expect(result).toEqual({ quarantined: false, crashCount: 1 });
    expect(lifecycle.quarantinePlugin).not.toHaveBeenCalled();
  });

  it('keeps crash counters separate by plugin, version, and isolation mode', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      version: '2.0.0',
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      mode: 'container',
      occurredAt: new Date('2026-01-01T00:02:00.000Z'),
    });
    const result = await service.recordRuntimeCrash({
      pluginId: 'com.other.plugin',
      version: '1.2.3',
      mode: 'worker_process',
      occurredAt: new Date('2026-01-01T00:03:00.000Z'),
    });

    expect(result).toEqual({ quarantined: false, crashCount: 1 });
    expect(lifecycle.quarantinePlugin).not.toHaveBeenCalled();
  });

  it('resets the crash window after a stable runtime health report', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    service.recordRuntimeHealthy(baseCrash);

    const result = await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:02:00.000Z'),
    });

    expect(result).toEqual({ quarantined: false, crashCount: 1 });
    expect(lifecycle.quarantinePlugin).not.toHaveBeenCalled();
  });

  it('prunes stale crash windows when recording newer runtime activity', async () => {
    await service.recordRuntimeCrash({
      ...baseCrash,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await service.recordRuntimeCrash({
      ...baseCrash,
      version: '2.0.0',
      occurredAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    await service.recordRuntimeCrash({
      ...baseCrash,
      pluginId: 'com.other.plugin',
      occurredAt: new Date('2026-01-01T00:11:00.001Z'),
    });

    expect(service.getTrackedRuntimeCount()).toBe(1);
  });
});
