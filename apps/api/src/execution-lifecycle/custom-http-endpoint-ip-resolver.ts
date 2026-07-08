import { Injectable, Logger } from '@nestjs/common';
import { ContainerHttpClientService } from '../docker/container-http-client.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING } from './execution-dispatch.settings';
import type {
  IOrchestratorIpResolver,
  OrchestratorIpResolverStrategy,
} from './execution-dispatch.service.types';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

/**
 * `custom_http_endpoint` strategy implementation of
 * {@link IOrchestratorIpResolver}.
 *
 * GETs an operator-configured URL (the
 * `execution_dispatch_ip_resolver_endpoint` system setting) and parses
 * the JSON response body for a top-level `{ "ip": "..." }` field.
 * This is the catch-all escape hatch for deployments whose IP-discovery
 * topology does not fit the other three strategies (e.g. a custom
 * control plane, a multi-region proxy, a tenancy-aware IP allocator).
 *
 * **Response contract**: the endpoint MUST respond with
 * `Content-Type: application/json` and a JSON object whose `ip` field
 * is a non-empty string that matches an IPv4 or full-form IPv6
 * literal. Anything else (text, missing field, malformed IP, non-2xx
 * status) surfaces as an {@link OrchestratorIpResolutionError}.
 *
 * **Settings** (required, on `SystemSettingsService`):
 * - `execution_dispatch_ip_resolver_endpoint` — absolute URL of the
 *   discovery endpoint. Consulted on every resolve call so operators
 *   can swap endpoints without restarting the API.
 *
 * Example configuration: set
 * `execution_dispatch_ip_resolver_override = 'custom_http_endpoint'`
 * AND
 * `execution_dispatch_ip_resolver_endpoint = 'https://ip-allocator.internal/orchestrator'`.
 * The endpoint must answer `GET` with `{ "ip": "172.16.5.12" }`
 * (Content-Type `application/json`).
 */
@Injectable()
export class CustomHttpEndpointIpResolver implements IOrchestratorIpResolver {
  private readonly logger = new Logger(CustomHttpEndpointIpResolver.name);

  constructor(
    private readonly httpClient: ContainerHttpClientService,
    private readonly settings: SystemSettingsService,
  ) {}

  async resolve(orchestratorUrl: string): Promise<string> {
    const endpoint = await this.readEndpoint();
    if (endpoint === undefined) {
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `System setting '${EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING}' must be configured before using the 'custom_http_endpoint' strategy (operator action required)`,
      );
    }

    let response: {
      statusCode: number;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    };
    try {
      response = await this.httpClient.httpGetRaw(endpoint, {
        timeoutMs: ENDPOINT_TIMEOUT_MS,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `Custom endpoint GET ${endpoint} failed: ${message}`,
        { cause },
      );
    }

    if (response.statusCode !== 200) {
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `Custom endpoint ${endpoint} returned status ${response.statusCode} (expected 200)`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch (cause) {
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `Custom endpoint ${endpoint} returned non-JSON body: ${truncateForError(response.body)}`,
        { cause },
      );
    }

    if (!isIpEnvelope(parsed)) {
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `Custom endpoint ${endpoint} must return a JSON object with a non-empty 'ip' string field`,
      );
    }

    const ip = parsed.ip.trim();
    if (!isValidIpLiteral(ip)) {
      throw new OrchestratorIpResolutionError(
        'custom_http_endpoint',
        orchestratorUrl,
        `Custom endpoint ${endpoint} returned invalid IP literal in 'ip' field: "${ip}"`,
      );
    }

    this.logger.debug(
      `custom_http_endpoint: resolved orchestrator IP ${ip} from ${endpoint}`,
    );
    return stripIpv6Brackets(ip);
  }

  /**
   * Read and validate the configured endpoint URL from
   * {@link SystemSettingsService}. The setting may be unset, an empty
   * string, or a non-string value — all of which surface as
   * `undefined` so the caller can raise a typed error explaining the
   * required configuration step. Returns `undefined` on read errors
   * (the typed error upstream will guide operators to the missing
   * setting without leaking the underlying SystemSettingsService
   * failure mode).
   */
  private async readEndpoint(): Promise<string | undefined> {
    let raw: unknown;
    try {
      raw = await this.settings.get<string | null>(
        EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING,
        null,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn(
        `Failed to read ${EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING} from SystemSettingsService: ${message}`,
      );
      return undefined;
    }
    if (typeof raw !== 'string') {
      return undefined;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    try {
      // Validate that the endpoint is a well-formed absolute URL; this
      // prevents downstream HTTP failures that would be harder to
      // diagnose (e.g. operator typo: trailing space, missing scheme).
      const parsed = new URL(trimmed);
      return parsed.toString();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.warn(
        `Ignoring malformed ${EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING}: ${message}`,
      );
      return undefined;
    }
  }
}

const ENDPOINT_TIMEOUT_MS = 2_000;

const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_PATTERN = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

function isValidIpLiteral(value: string): boolean {
  const unbracketed = stripIpv6Brackets(value);
  return IPV4_PATTERN.test(unbracketed) || IPV6_PATTERN.test(unbracketed);
}

function stripIpv6Brackets(value: string): string {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Type guard narrowing an arbitrary JSON value to the response envelope
 * `{ "ip": string }` we accept. Defensive against operators who ship
 * richer payloads (e.g. `{ "ip": "...", "ttl": 60 }`) by only
 * inspecting the `ip` field and ignoring everything else.
 */
function isIpEnvelope(value: unknown): value is { ip: string } {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = (value as Record<string, unknown>)['ip'];
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

/**
 * Truncate a body string for inclusion in an error message. Keeps
 * payloads short so we never accidentally log full HTML error pages
 * (which the orchestrator's reverse proxy might serve on a 404).
 */
function truncateForError(body: string, max = 200): string {
  if (body.length <= max) {
    return body;
  }
  return `${body.slice(0, max)}\u2026 (truncated ${body.length - max} chars)`;
}

/**
 * Strategy identifier exported alongside the implementation for the
 * delegating resolver's strategy map.
 */
export const CUSTOM_HTTP_ENDPOINT_STRATEGY: OrchestratorIpResolverStrategy =
  'custom_http_endpoint';
