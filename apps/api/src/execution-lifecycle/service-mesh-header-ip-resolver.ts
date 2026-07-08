import { Injectable, Logger, Optional } from '@nestjs/common';
import { ContainerHttpClientService } from '../docker/container-http-client.service';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type {
  IOrchestratorIpResolver,
  OrchestratorIpResolverStrategy,
} from './execution-dispatch.service.types';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

/**
 * `service_mesh_header` strategy implementation of
 * {@link IOrchestratorIpResolver}.
 *
 * Issues a sentinel `GET /healthz` against the orchestrator URL and
 * trusts the orchestrator to return its own routable IP in the
 * `X-Orchestrator-Ip` response header. This is the integration path
 * used by Istio / Linkerd deployments where the orchestrator pod's
 * `ClusterIP` / `ClusterIP` NAT IP is not routable across the mesh —
 * the orchestrator (which already runs the container's HTTP server)
 * knows its own mesh-allocated address and advertises it via the
 * header.
 *
 * The sentinel is `GET /healthz` (not the existing `GET /health` used
 * by `ContainerHttpClientService.waitForHealth`) because Istio /
 * Linkerd typically require the sentinel endpoint to live on a
 * separate path so the mesh-side health-check traffic can be
 * distinguished from container-side probes. The orchestrator's
 * `/healthz` is documented in the platform runbook as the
 * service-mesh sentinel.
 *
 * **IP validation**: the header value is trimmed and matched against
 * {@link IPV4_PATTERN} and {@link IPV6_PATTERN}. Bracketed IPv6
 * literals (e.g. `[::1]`) are stripped of their brackets before the
 * pattern check; the IP is returned without brackets since callers
 * consume it as an IP literal, not a URL host.
 *
 * **HTTP client**: {@link ContainerHttpClientService} is injected via
 * constructor (per the task spec — no static `fetch`) so the
 * resolver is unit-testable with a mock HTTP client. The resolver
 * uses the new `httpGetRaw` method on the service, which returns the
 * response status, headers, and body in a single round-trip.
 *
 * **Settings** (optional, on `SystemSettingsService`):
 * - none currently. Reserved for Milestone 4+ tuning knobs (e.g.
 *   `service_mesh_header_timeout_ms`, `service_mesh_header_path`).
 *
 * Example configuration: set
 * `execution_dispatch_ip_resolver_override = 'service_mesh_header'`
 * and ensure the orchestrator's `/healthz` returns an
 * `X-Orchestrator-Ip` header on every response (Istio / Linkerd
 * deployments typically set this in the sidecar filter chain).
 */
@Injectable()
export class ServiceMeshHeaderIpResolver implements IOrchestratorIpResolver {
  private readonly logger = new Logger(ServiceMeshHeaderIpResolver.name);

  constructor(
    private readonly httpClient: ContainerHttpClientService,
    @Optional() _settings?: SystemSettingsService,
  ) {
    void _settings;
  }

  async resolve(orchestratorUrl: string): Promise<string> {
    const healthUrl = new URL('/healthz', orchestratorUrl).toString();
    let response: {
      statusCode: number;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    };
    try {
      response = await this.httpClient.httpGetRaw(healthUrl, {
        timeoutMs: HEALTHZ_TIMEOUT_MS,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new OrchestratorIpResolutionError(
        'service_mesh_header',
        orchestratorUrl,
        `Sentinel GET ${healthUrl} failed: ${message}`,
        { cause },
      );
    }

    if (response.statusCode !== 200) {
      throw new OrchestratorIpResolutionError(
        'service_mesh_header',
        orchestratorUrl,
        `Sentinel ${healthUrl} returned status ${response.statusCode} (expected 200)`,
      );
    }

    const rawHeader = readHeader(response.headers, 'x-orchestrator-ip');
    if (rawHeader === undefined) {
      throw new OrchestratorIpResolutionError(
        'service_mesh_header',
        orchestratorUrl,
        `Sentinel ${healthUrl} response missing required 'X-Orchestrator-Ip' header`,
      );
    }

    const ip = rawHeader.trim();
    if (!isValidIpLiteral(ip)) {
      throw new OrchestratorIpResolutionError(
        'service_mesh_header',
        orchestratorUrl,
        `Sentinel ${healthUrl} returned invalid IP literal in 'X-Orchestrator-Ip': "${ip}"`,
      );
    }

    this.logger.debug(
      `service_mesh_header: resolved orchestrator IP ${ip} from ${healthUrl}`,
    );
    return stripIpv6Brackets(ip);
  }
}

const HEALTHZ_TIMEOUT_MS = 2_000;

/**
 * RFC 2673 / RFC 5321 dotted-quad IPv4 literal. Permissive on the
 * octet ranges (0-255) — the WHATWG URL parser will reject literals
 * outside the legal IPv4 range when the IP is later used as a host,
 * so we only need a coarse shape check here.
 */
const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Eight-group hex IPv6 literal (no embedded IPv4, no zone-id). We do
 * NOT accept the shorthand `::` notation here because the canonical
 * form is what `dns/promises.lookup` and the orchestrator's reverse
 * DNS expect; if the orchestrator emits shorthand we surface it as a
 * failure rather than risk a malformed IP reaching `buildBaseUrl`.
 */
const IPV6_PATTERN = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

/**
 * Validate that a trimmed header value is either a dotted-quad IPv4
 * literal or a bracketed/bracketless full-form IPv6 literal. Used as
 * the last gate before returning the IP to the caller; anything that
 * does not match these patterns (including hostnames, port-bearing
 * strings, and shorthand IPv6) is treated as a malformed sentinel
 * response.
 */
function isValidIpLiteral(value: string): boolean {
  const unbracketed = stripIpv6Brackets(value);
  return IPV4_PATTERN.test(unbracketed) || IPV6_PATTERN.test(unbracketed);
}

/**
 * Case-insensitive header lookup that tolerates Node's
 * `http.IncomingHttpHeaders` shape (values may be `string | string[] | undefined`).
 * Returns the first string value when the header is repeated.
 */
function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct) && direct.length > 0) {
    const first = direct[0];
    if (typeof first === 'string') {
      return first;
    }
  }
  const lower = headers[name.toLowerCase()];
  if (typeof lower === 'string') {
    return lower;
  }
  if (Array.isArray(lower) && lower.length > 0) {
    const first = lower[0];
    if (typeof first === 'string') {
      return first;
    }
  }
  return undefined;
}

function stripIpv6Brackets(value: string): string {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Strategy identifier exported alongside the implementation for the
 * delegating resolver's strategy map.
 */
export const SERVICE_MESH_HEADER_STRATEGY: OrchestratorIpResolverStrategy =
  'service_mesh_header';
