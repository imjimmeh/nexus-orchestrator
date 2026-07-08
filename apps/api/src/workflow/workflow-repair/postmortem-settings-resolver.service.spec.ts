import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { PostmortemSettingsResolver } from './postmortem-settings-resolver.service';
import type { ResolvedPostmortemSettings } from './postmortem-settings-resolver.types';
import {
  WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
  WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
} from './workflow-failure-postmortem.constants';

function createSettings(
  options: {
    enabled?: unknown;
    delaySeconds?: unknown;
  } = {},
) {
  return {
    get: vi.fn(async (key: string) => {
      if (key === 'workflow_postmortem_writeback_enabled') {
        return options.enabled;
      }
      if (key === 'workflow_postmortem_writeback_delay_seconds') {
        return options.delaySeconds;
      }
      return undefined;
    }),
  };
}

function createResolver(
  options: {
    enabled?: unknown;
    delaySeconds?: unknown;
  } = {},
) {
  const settings = createSettings(options);
  const resolver = new PostmortemSettingsResolver(
    settings as unknown as SystemSettingsService,
  );
  return { resolver, settings };
}

describe('PostmortemSettingsResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kill-switch-off: returns enabled=false and the default delay when enabled is stored as false and delay is missing', async () => {
    const { resolver, settings } = createResolver({
      enabled: false,
      // delaySeconds omitted -> settings.get returns undefined
    });

    const result: ResolvedPostmortemSettings = await resolver.resolveSettings();

    expect(result).toEqual({
      enabled: false,
      delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
    });
    expect(settings.get).toHaveBeenCalledWith(
      'workflow_postmortem_writeback_enabled',
      WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
    );
    expect(settings.get).toHaveBeenCalledWith(
      'workflow_postmortem_writeback_delay_seconds',
      WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
    );
  });

  it('kill-switch-off (defaults): returns the full defaults when both settings are missing', async () => {
    const { resolver } = createResolver();

    expect(await resolver.resolveSettings()).toEqual({
      enabled: WORKFLOW_POSTMORTEM_DEFAULT_ENABLED,
      delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
    });
  });

  it('kill-switch-on-with-zero-delay: returns enabled=true with delaySeconds=0 (no-op sleep)', async () => {
    const { resolver } = createResolver({
      enabled: true,
      delaySeconds: 0,
    });

    expect(await resolver.resolveSettings()).toEqual({
      enabled: true,
      delaySeconds: 0,
    });
  });

  it('kill-switch-on-with-positive-delay: returns enabled=true with delaySeconds=60 from a numeric string', async () => {
    const { resolver } = createResolver({
      enabled: true,
      delaySeconds: '60',
    });

    expect(await resolver.resolveSettings()).toEqual({
      enabled: true,
      delaySeconds: 60,
    });
  });

  describe('malformed-string-fallback: coerceDelaySeconds fallbacks (via resolveSettings)', () => {
    it('falls back when given a non-numeric string ("abc")', async () => {
      const { resolver } = createResolver({
        enabled: true,
        delaySeconds: 'abc',
      });
      expect(await resolver.resolveSettings()).toEqual({
        enabled: true,
        delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
      });
    });

    it('falls back when given a negative number (-1)', async () => {
      const { resolver } = createResolver({
        enabled: true,
        delaySeconds: -1,
      });
      expect(await resolver.resolveSettings()).toEqual({
        enabled: true,
        delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
      });
    });

    it('floors fractional positive numbers (3.7 -> 3)', async () => {
      const { resolver } = createResolver({
        enabled: true,
        delaySeconds: 3.7,
      });
      expect(await resolver.resolveSettings()).toEqual({
        enabled: true,
        delaySeconds: 3,
      });
    });

    it('falls back for NaN', async () => {
      const { resolver } = createResolver({
        enabled: true,
        delaySeconds: Number.NaN,
      });
      expect(await resolver.resolveSettings()).toEqual({
        enabled: true,
        delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
      });
    });

    it('falls back for an empty string', async () => {
      const { resolver } = createResolver({
        enabled: true,
        delaySeconds: '',
      });
      expect(await resolver.resolveSettings()).toEqual({
        enabled: true,
        delaySeconds: WORKFLOW_POSTMORTEM_DEFAULT_DELAY_SECONDS,
      });
    });
  });
});
