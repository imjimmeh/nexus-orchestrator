import { Inject, Injectable, Logger } from '@nestjs/common';
import { SystemSettingsService } from '../settings/system-settings.service';
import { ExecutionEventPublisher } from './execution-event.publisher';
import {
  EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING,
  DEFAULT_RESOLVER_STRATEGY,
  isKnownResolverStrategy,
} from './execution-dispatch.settings';
import {
  CUSTOM_HTTP_ENDPOINT_IP_RESOLVER,
  DEFAULT_ORCHESTRATOR_IP_RESOLVER,
  DNS_ROUND_ROBIN_IP_RESOLVER,
  ORCHESTRATOR_IP_RESOLVER,
  SERVICE_MESH_HEADER_IP_RESOLVER,
  OrchestratorIpResolutionError,
} from './execution-dispatch.service.types';
import type {
  IOrchestratorIpResolver,
  OrchestratorIpResolverStrategy,
} from './execution-dispatch.service.types';

/**
 * SystemSetting-aware delegating implementation of
 * {@link IOrchestratorIpResolver}.
 *
 * Reads the `execution_dispatch_ip_resolver_override` system setting
 * on every call (so operators can switch strategies without a
 * restart), validates the value against the known
 * {@link OrchestratorIpResolverStrategy} set, and delegates to one of
 * four injected concrete resolvers via per-strategy DI tokens:
 *
 * - `'default'` → {@link DEFAULT_ORCHESTRATOR_IP_RESOLVER} (URL parse)
 * - `'dns_round_robin'` → {@link DNS_ROUND_ROBIN_ORCHESTRATOR_IP_RESOLVER}
 * - `'service_mesh_header'` → {@link SERVICE_MESH_HEADER_ORCHESTRATOR_IP_RESOLVER}
 * - `'custom_http_endpoint'` → {@link CUSTOM_ORCHESTRATOR_IP_RESOLVER}
 *
 * Unknown / unset values fall back to `'default'` with a warn-log so
 * a stale override cannot brick the dispatch loop.
 *
 * **Telemetry**: every successful resolution emits an
 * `execution.dispatch.ip_resolved` event via
 * {@link ExecutionEventPublisher.ipResolved} carrying the strategy,
 * resolved IP, and a sanitized orchestrator URL (no user-info, no
 * query string). Failures emit
 * `execution.dispatch.ip_resolution_failed` and are then re-thrown so
 * the upstream polling loop in
 * `ExecutionDispatchService.resolveIpFromOrchestrator` continues to
 * treat the failure as a transient retry condition (preserving the
 * pre-Milestone-3 retry semantics).
 *
 * **Failure semantics**: the resolver does NOT swallow underlying
 * resolver errors — they propagate to the caller after emitting the
 * failure telemetry event. This is intentional: the existing
 * `ExecutionDispatchService.resolveIpFromOrchestrator` already wraps
 * the resolver call in a try/catch that returns `undefined` on
 * failure (so the polling loop in `resolveContainerIp` retries), and
 * introducing a second swallowing layer here would mask the
 * `OrchestratorIpResolutionError.cause` chain from logs.
 *
 * **DI strategy**: per-strategy tokens are used (rather than
 * concrete-type injection) so the delegator can be unit-tested by
 * substituting one resolver at a time without the
 * multi-provider-same-type ambiguity NestJS raises when multiple
 * providers share a concrete class token.
 */
@Injectable()
export class SystemSettingOrchestratorIpResolver implements IOrchestratorIpResolver {
  private readonly logger = new Logger(
    SystemSettingOrchestratorIpResolver.name,
  );

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly eventPublisher: ExecutionEventPublisher,
    @Inject(DEFAULT_ORCHESTRATOR_IP_RESOLVER)
    private readonly defaultResolver: IOrchestratorIpResolver,
    @Inject(DNS_ROUND_ROBIN_IP_RESOLVER)
    private readonly dnsRoundRobinResolver: IOrchestratorIpResolver,
    @Inject(SERVICE_MESH_HEADER_IP_RESOLVER)
    private readonly serviceMeshHeaderResolver: IOrchestratorIpResolver,
    @Inject(CUSTOM_HTTP_ENDPOINT_IP_RESOLVER)
    private readonly customHttpEndpointResolver: IOrchestratorIpResolver,
  ) {}

  /**
   * Expose the ORCHESTRATOR_IP_RESOLVER token value as a class-level
   * constant for module-registration ergonomics — kept here (rather
   * than imported from the types file) so the module file does not
   * need to also import `ORCHESTRATOR_IP_RESOLVER` separately when
   * wiring this resolver.
   */
  static readonly token = ORCHESTRATOR_IP_RESOLVER;

  async resolve(orchestratorUrl: string): Promise<string> {
    const strategy = await this.readStrategy();

    const resolver = this.resolverFor(strategy);
    try {
      const resolvedIp = await resolver.resolve(orchestratorUrl);
      const sanitizedUrl = sanitizeOrchestratorUrl(orchestratorUrl);
      await this.eventPublisher.ipResolved({
        strategy,
        resolvedIp,
        orchestratorUrl: sanitizedUrl,
      });
      return resolvedIp;
    } catch (error) {
      const sanitizedUrl = sanitizeOrchestratorUrl(orchestratorUrl);
      const message = error instanceof Error ? error.message : String(error);
      // Cast `error` to `OrchestratorIpResolutionError` when possible
      // so the failure event carries the strategy that actually ran
      // (which may differ from the override when an upstream resolver
      // re-threw its own typed error from a nested call). Falls back
      // to the override strategy when the error is untyped.
      const failingStrategy =
        error instanceof OrchestratorIpResolutionError
          ? error.strategy
          : strategy;
      await this.eventPublisher.ipResolutionFailed({
        strategy: failingStrategy,
        orchestratorUrl: sanitizedUrl,
        errorMessage: message,
      });
      throw error;
    }
  }

  /**
   * Read the override setting and validate it against the known
   * strategy set. Returns `'default'` (and emits a warn-log) on
   * unset / non-string / unknown values so a stale override cannot
   * brick the dispatch loop.
   */
  private async readStrategy(): Promise<OrchestratorIpResolverStrategy> {
    let raw: unknown;
    try {
      raw = await this.settings.get<string>(
        EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING,
        DEFAULT_RESOLVER_STRATEGY,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn(
        `Failed to read ${EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING}; falling back to '${DEFAULT_RESOLVER_STRATEGY}': ${message}`,
      );
      return DEFAULT_RESOLVER_STRATEGY;
    }
    if (isKnownResolverStrategy(raw)) {
      return raw;
    }
    this.logger.warn(
      `Ignoring unknown ${EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING} value "${String(
        raw,
      )}"; falling back to '${DEFAULT_RESOLVER_STRATEGY}'`,
    );
    return DEFAULT_RESOLVER_STRATEGY;
  }

  /**
   * Pick the injected resolver for the given strategy. Centralised so
   * the strategy map has exactly one source of truth and so the
   * `exhaustive` switch surfaces a compile error when a new strategy
   * is added without registering a resolver.
   */
  private resolverFor(
    strategy: OrchestratorIpResolverStrategy,
  ): IOrchestratorIpResolver {
    switch (strategy) {
      case 'default':
        return this.defaultResolver;
      case 'dns_round_robin':
        return this.dnsRoundRobinResolver;
      case 'service_mesh_header':
        return this.serviceMeshHeaderResolver;
      case 'custom_http_endpoint':
        return this.customHttpEndpointResolver;
      default: {
        // Exhaustiveness check — TypeScript narrows `strategy` to
        // `never` here when every member of the union is handled.
        const exhaustive: never = strategy;
        throw new Error(
          `Unhandled orchestrator IP resolver strategy: ${String(exhaustive)}`,
        );
      }
    }
  }
}

/**
 * Strip the userinfo (basic-auth credentials) and any query / fragment
 * from an orchestrator URL so the telemetry payload never carries
 * `https://user:pass@host:port/path?token=...` through the event log.
 * The WHATWG URL parser normalises the result, so `https://user:pass@host`
 * becomes `https://host/` (the trailing slash is intentional and
 * stable).
 */
export function sanitizeOrchestratorUrl(orchestratorUrl: string): string {
  try {
    const parsed = new URL(orchestratorUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    // Malformed URL — return the input verbatim rather than throw,
    // because the telemetry path must never fail the dispatch loop.
    return orchestratorUrl;
  }
}
