import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemSettingsService } from '../settings/system-settings.service';
import { ExecutionEventPublisher } from './execution-event.publisher';
import {
  CUSTOM_HTTP_ENDPOINT_IP_RESOLVER,
  DEFAULT_ORCHESTRATOR_IP_RESOLVER,
  DNS_ROUND_ROBIN_IP_RESOLVER,
  OrchestratorIpResolutionError,
  SERVICE_MESH_HEADER_IP_RESOLVER,
} from './execution-dispatch.service.types';
import type {
  IOrchestratorIpResolver,
  OrchestratorIpResolverStrategy,
} from './execution-dispatch.service.types';
import { EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING } from './execution-dispatch.settings';
import {
  sanitizeOrchestratorUrl,
  SystemSettingOrchestratorIpResolver,
} from './system-setting-orchestrator-ip-resolver';

type OverrideSettingValue = OrchestratorIpResolverStrategy | null | 'unknown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORCHESTRATOR_URL = 'http://orchestrator.local:3010';
const SANITIZED_URL = 'http://orchestrator.local:3010/';
// sanitizeOrchestratorUrl preserves port + path (only userinfo, query,
// and fragment are cleared), so `https://user:pass@host:1/path?q=1#h`
// becomes `https://host:1/path`.
const SANITIZED_URL_WITH_USERINFO = 'https://orchestrator.local:1/path';
const DIRTY_URL = 'https://user:pass@orchestrator.local:1/path?q=1#h';
const RESOLVED_IP = '10.0.0.42';

function makeSettings(overrideValue: OverrideSettingValue) {
  const get = vi
    .fn<[string, string], Promise<unknown>>()
    .mockImplementation(async (_key, defaultValue) => {
      if (overrideValue === null) {
        return defaultValue;
      }
      return overrideValue;
    });
  return { get } as unknown as SystemSettingsService & {
    get: ReturnType<typeof vi.fn>;
  };
}

function makeEventPublisher() {
  return {
    ipResolved: vi.fn().mockResolvedValue(undefined),
    ipResolutionFailed: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExecutionEventPublisher & {
    ipResolved: ReturnType<typeof vi.fn>;
    ipResolutionFailed: ReturnType<typeof vi.fn>;
  };
}

function makeResolver(returnValue: string | Error) {
  const resolve = vi.fn();
  if (returnValue instanceof Error) {
    resolve.mockRejectedValue(returnValue);
  } else {
    resolve.mockResolvedValue(returnValue);
  }
  return { resolve } as unknown as IOrchestratorIpResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function buildDelegator(opts: {
  settingsValue: OverrideSettingValue;
  defaultResolver?: IOrchestratorIpResolver;
  dnsRoundRobinResolver?: IOrchestratorIpResolver;
  serviceMeshHeaderResolver?: IOrchestratorIpResolver;
  customHttpEndpointResolver?: IOrchestratorIpResolver;
}) {
  const settings = makeSettings(opts.settingsValue);
  const eventPublisher = makeEventPublisher();
  const defaultResolver = opts.defaultResolver ?? makeResolver(RESOLVED_IP);
  const dnsRoundRobinResolver =
    opts.dnsRoundRobinResolver ?? makeResolver(RESOLVED_IP);
  const serviceMeshHeaderResolver =
    opts.serviceMeshHeaderResolver ?? makeResolver(RESOLVED_IP);
  const customHttpEndpointResolver =
    opts.customHttpEndpointResolver ?? makeResolver(RESOLVED_IP);

  const delegator = new SystemSettingOrchestratorIpResolver(
    settings,
    eventPublisher,
    defaultResolver,
    dnsRoundRobinResolver,
    serviceMeshHeaderResolver,
    customHttpEndpointResolver,
  );

  return {
    delegator,
    settings,
    eventPublisher,
    defaultResolver,
    dnsRoundRobinResolver,
    serviceMeshHeaderResolver,
    customHttpEndpointResolver,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SystemSettingOrchestratorIpResolver', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // NestJS Logger writes its warn-level entries to process.stdout
    // (and errors to process.stderr); spy on stdout.write so we can
    // assert the warning payload the resolver emits when an override
    // value is invalid or the settings service throws.
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('strategy dispatch', () => {
    it('routes to the default resolver and emits ipResolved when the override is "default"', async () => {
      const ctx = buildDelegator({ settingsValue: 'default' });

      await expect(ctx.delegator.resolve(ORCHESTRATOR_URL)).resolves.toBe(
        RESOLVED_IP,
      );

      expect(ctx.defaultResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.dnsRoundRobinResolver.resolve).not.toHaveBeenCalled();
      expect(ctx.serviceMeshHeaderResolver.resolve).not.toHaveBeenCalled();
      expect(ctx.customHttpEndpointResolver.resolve).not.toHaveBeenCalled();

      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledTimes(1);
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'default',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
      expect(ctx.eventPublisher.ipResolutionFailed).not.toHaveBeenCalled();
    });

    it('routes to the dns_round_robin resolver when the override is "dns_round_robin"', async () => {
      const ctx = buildDelegator({ settingsValue: 'dns_round_robin' });

      await ctx.delegator.resolve(ORCHESTRATOR_URL);

      expect(ctx.dnsRoundRobinResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.defaultResolver.resolve).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'dns_round_robin',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
    });

    it('routes to the service_mesh_header resolver when the override is "service_mesh_header"', async () => {
      const ctx = buildDelegator({ settingsValue: 'service_mesh_header' });

      await ctx.delegator.resolve(ORCHESTRATOR_URL);

      expect(ctx.serviceMeshHeaderResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.defaultResolver.resolve).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'service_mesh_header',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
    });

    it('routes to the custom_http_endpoint resolver when the override is "custom_http_endpoint"', async () => {
      const ctx = buildDelegator({ settingsValue: 'custom_http_endpoint' });

      await ctx.delegator.resolve(ORCHESTRATOR_URL);

      expect(ctx.customHttpEndpointResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.defaultResolver.resolve).not.toHaveBeenCalled();
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'custom_http_endpoint',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
    });

    it('falls back to the default resolver and logs a warn when the override is unknown', async () => {
      const ctx = buildDelegator({ settingsValue: 'unknown_strategy' });

      await ctx.delegator.resolve(ORCHESTRATOR_URL);

      expect(ctx.defaultResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'default',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
      const logOutput = stdoutSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .join('');
      expect(logOutput).toMatch(/unknown_strategy/);
    });

    it('falls back to the default resolver silently when the override is unset', async () => {
      const ctx = buildDelegator({ settingsValue: null });

      await ctx.delegator.resolve(ORCHESTRATOR_URL);

      expect(ctx.defaultResolver.resolve).toHaveBeenCalledWith(
        ORCHESTRATOR_URL,
      );
      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'default',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
      const logOutput = stdoutSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .join('');
      expect(logOutput).not.toMatch(/unknown/);
    });

    it('falls back to the default resolver and logs a warn when the settings service throws', async () => {
      const get = vi
        .fn<[string, string], Promise<unknown>>()
        .mockRejectedValue(new Error('db down'));
      const settings = { get } as unknown as SystemSettingsService & {
        get: ReturnType<typeof vi.fn>;
      };
      const eventPublisher = makeEventPublisher();
      const delegator = new SystemSettingOrchestratorIpResolver(
        settings,
        eventPublisher,
        makeResolver(RESOLVED_IP),
        makeResolver(RESOLVED_IP),
        makeResolver(RESOLVED_IP),
        makeResolver(RESOLVED_IP),
      );

      await delegator.resolve(ORCHESTRATOR_URL);

      expect(eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'default',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL,
      });
      const logOutput = stdoutSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .join('');
      expect(logOutput).toMatch(/db down/);
    });
  });

  describe('failure telemetry', () => {
    it('emits ip_resolution_failed with the strategy that actually ran and re-throws a typed error', async () => {
      const typedError = new OrchestratorIpResolutionError(
        'dns_round_robin',
        ORCHESTRATOR_URL,
        'lookup blew up',
      );
      const dnsRoundRobinResolver = makeResolver(typedError);
      const ctx = buildDelegator({
        settingsValue: 'dns_round_robin',
        dnsRoundRobinResolver,
      });

      await expect(ctx.delegator.resolve(ORCHESTRATOR_URL)).rejects.toBe(
        typedError,
      );

      expect(ctx.eventPublisher.ipResolutionFailed).toHaveBeenCalledTimes(1);
      expect(ctx.eventPublisher.ipResolutionFailed).toHaveBeenCalledWith({
        strategy: 'dns_round_robin',
        orchestratorUrl: SANITIZED_URL,
        errorMessage: 'lookup blew up',
      });
      expect(ctx.eventPublisher.ipResolved).not.toHaveBeenCalled();
    });

    it('uses the override strategy in the failure event when the underlying resolver throws a plain Error', async () => {
      const plainError = new Error('socket hang up');
      const serviceMeshHeaderResolver = makeResolver(plainError);
      const ctx = buildDelegator({
        settingsValue: 'service_mesh_header',
        serviceMeshHeaderResolver,
      });

      await expect(ctx.delegator.resolve(ORCHESTRATOR_URL)).rejects.toBe(
        plainError,
      );

      expect(ctx.eventPublisher.ipResolutionFailed).toHaveBeenCalledWith({
        strategy: 'service_mesh_header',
        orchestratorUrl: SANITIZED_URL,
        errorMessage: 'socket hang up',
      });
    });

    it('preserves a non-Error thrown value by stringifying it into the failure event message', async () => {
      const defaultResolver = {
        resolve: vi.fn().mockRejectedValue('string thrown value'),
      } as unknown as IOrchestratorIpResolver & {
        resolve: ReturnType<typeof vi.fn>;
      };
      const ctx = buildDelegator({
        settingsValue: 'default',
        defaultResolver,
      });

      await expect(ctx.delegator.resolve(ORCHESTRATOR_URL)).rejects.toBe(
        'string thrown value',
      );

      expect(ctx.eventPublisher.ipResolutionFailed).toHaveBeenCalledWith({
        strategy: 'default',
        orchestratorUrl: SANITIZED_URL,
        errorMessage: 'string thrown value',
      });
    });
  });

  describe('URL sanitization', () => {
    it('strips userinfo, query, and fragment from the orchestrator URL in ipResolved events', async () => {
      const ctx = buildDelegator({ settingsValue: 'default' });

      await ctx.delegator.resolve(DIRTY_URL);

      expect(ctx.eventPublisher.ipResolved).toHaveBeenCalledWith({
        strategy: 'default',
        resolvedIp: RESOLVED_IP,
        orchestratorUrl: SANITIZED_URL_WITH_USERINFO,
      });
    });

    it('strips userinfo, query, and fragment from the orchestrator URL in ip_resolution_failed events', async () => {
      const defaultResolver = makeResolver(
        new OrchestratorIpResolutionError('default', DIRTY_URL, 'boom'),
      );
      const ctx = buildDelegator({
        settingsValue: 'default',
        defaultResolver,
      });

      await expect(ctx.delegator.resolve(DIRTY_URL)).rejects.toThrow();

      expect(ctx.eventPublisher.ipResolutionFailed).toHaveBeenCalledWith({
        strategy: 'default',
        orchestratorUrl: SANITIZED_URL_WITH_USERINFO,
        errorMessage: 'boom',
      });
    });

    it('returns the input verbatim when the URL is malformed so telemetry never throws', () => {
      expect(sanitizeOrchestratorUrl('not a url')).toBe('not a url');
    });

    it('strips query strings from orchestrator URLs without userinfo', () => {
      expect(sanitizeOrchestratorUrl('http://host:3010/path?q=1')).toBe(
        'http://host:3010/path',
      );
    });

    it('strips fragments from orchestrator URLs without userinfo', () => {
      expect(sanitizeOrchestratorUrl('http://host:3010/path#frag')).toBe(
        'http://host:3010/path',
      );
    });
  });

  describe('module DI surface', () => {
    it('exposes the ORCHESTRATOR_IP_RESOLVER token as a class-level constant for module wiring', () => {
      // The static accessor returns the same symbol that the file exports
      // for ORCHESTRATOR_IP_RESOLVER — assert identity via the symbol
      // description to keep the test stable if the symbol identity changes.
      const symbol = SystemSettingOrchestratorIpResolver.token;
      expect(symbol.toString()).toBe('Symbol(ORCHESTRATOR_IP_RESOLVER)');
    });

    it('uses the per-strategy tokens documented in the architecture doc', () => {
      // Pin the documented per-strategy token identities so a future
      // rename surfaces as a failing test rather than a silent DI break.
      expect(DEFAULT_ORCHESTRATOR_IP_RESOLVER.toString()).toBe(
        'Symbol(DEFAULT_ORCHESTRATOR_IP_RESOLVER)',
      );
      expect(DNS_ROUND_ROBIN_IP_RESOLVER.toString()).toBe(
        'Symbol(DNS_ROUND_ROBIN_IP_RESOLVER)',
      );
      expect(SERVICE_MESH_HEADER_IP_RESOLVER.toString()).toBe(
        'Symbol(SERVICE_MESH_HEADER_IP_RESOLVER)',
      );
      expect(CUSTOM_HTTP_ENDPOINT_IP_RESOLVER.toString()).toBe(
        'Symbol(CUSTOM_HTTP_ENDPOINT_IP_RESOLVER)',
      );
      expect(EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING).toBe(
        'execution_dispatch_ip_resolver_override',
      );
    });
  });
});
