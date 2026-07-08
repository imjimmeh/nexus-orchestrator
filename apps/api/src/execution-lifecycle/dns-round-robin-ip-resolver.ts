import { Injectable, Logger, Optional } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { randomInt } from 'node:crypto';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type {
  IOrchestratorIpResolver,
  OrchestratorIpResolverStrategy,
} from './execution-dispatch.service.types';
import { OrchestratorIpResolutionError } from './execution-dispatch.service.types';

/**
 * `dns_round_robin` strategy implementation of {@link IOrchestratorIpResolver}.
 *
 * Looks up the orchestrator's A/AAAA records via `dns/promises.lookup`
 * and returns a uniformly-random entry — useful when the orchestrator
 * is deployed behind a DNS round-robin pool but the dispatch loop wants
 * stickiness (e.g. for warm caches, in-flight session affinity, or to
 * avoid hammering the same replica during a burst).
 *
 * **TTL cache**: the resolver sticks to the first IP it picks for a
 * given host for `STICKY_TTL_MS` (60 seconds) before re-shuffling.
 * This mirrors the operational guidance for the upstream execution
 * flow — the dispatcher polls the orchestrator's IP every 500ms via
 * `ExecutionDispatchService.resolveContainerIp`, and re-shuffling on
 * every poll would cause the in-flight kickoff to repeatedly change
 * target hosts. Operators that need pure round-robin can shorten /
 * zero the TTL via a future setting (currently hard-coded).
 *
 * **IPv6 hosts** are stripped of their surrounding brackets before
 * the DNS lookup (so `[::1]` becomes `::1`); the response address is
 * returned as the DNS resolver reports it (no bracket re-wrapping),
 * since callers consume it as an IP literal, not a URL host.
 *
 * **Settings**: the optional `SystemSettingsService` constructor
 * parameter is accepted but unused today — it is wired now so
 * Milestone 4+ can introduce tuning knobs (e.g.
 * `dns_round_robin_ttl_seconds`, `dns_round_robin_record_type`)
 * without re-plumbing DI.
 *
 * Example configuration: set
 * `execution_dispatch_ip_resolver_override = 'dns_round_robin'` and
 * ensure the orchestrator URL's host is a DNS name (not a literal IP).
 */
@Injectable()
export class DnsRoundRobinIpResolver implements IOrchestratorIpResolver {
  private readonly logger = new Logger(DnsRoundRobinIpResolver.name);
  private readonly stickyCache = new Map<
    string,
    { ip: string; expiresAt: number }
  >();

  constructor(@Optional() _settings?: SystemSettingsService) {
    void _settings;
  }

  async resolve(orchestratorUrl: string): Promise<string> {
    const parsed = new URL(orchestratorUrl);
    const host = stripIpv6Brackets(parsed.hostname);
    if (!host) {
      throw new OrchestratorIpResolutionError(
        'dns_round_robin',
        orchestratorUrl,
        `Cannot perform DNS lookup on empty host from URL "${orchestratorUrl}"`,
      );
    }

    const cached = this.stickyCache.get(host);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.ip;
    }

    let records: { address: string; family: number }[];
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new OrchestratorIpResolutionError(
        'dns_round_robin',
        orchestratorUrl,
        `DNS lookup failed for "${host}": ${message}`,
        { cause },
      );
    }

    if (records.length === 0) {
      throw new OrchestratorIpResolutionError(
        'dns_round_robin',
        orchestratorUrl,
        `DNS lookup for "${host}" returned no A/AAAA records`,
      );
    }

    const chosen = pickRandomRecord(records);
    this.stickyCache.set(host, {
      ip: chosen.address,
      expiresAt: now + STICKY_TTL_MS,
    });
    this.logger.debug(
      `dns_round_robin: chose ${chosen.address} (family=${chosen.family}) from ${records.length} records for "${host}"`,
    );
    return chosen.address;
  }
}

/**
 * Hard-coded sticky-cache TTL in milliseconds. Re-shuffles after this
 * many ms so the dispatcher picks a different replica (eventually).
 */
const STICKY_TTL_MS = 60_000;

/**
 * Strip the surrounding brackets that WHATWG URL applies to IPv6
 * hosts (e.g. `http://[::1]:3000/` → hostname `[::1]` → bare `::1`).
 * `dns/promises.lookup` rejects bracketed literals because it
 * interprets the brackets as the DNS search-list syntax.
 */
function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Pick a uniformly-random record from the DNS A/AAAA result set using
 * `crypto.randomInt` (which is unbiased, unlike `Math.floor(Math.random()
 * * length)`). The caller MUST guarantee `records.length > 0`; this
 * helper exists separately so TypeScript can prove the index access
 * without resorting to a `!` non-null assertion (forbidden by the
 * project's lint config).
 */
function pickRandomRecord(
  records: readonly { address: string; family: number }[],
): { address: string; family: number } {
  const index = randomInt(records.length);
  const chosen = records[index];
  if (chosen === undefined) {
    // Unreachable: randomInt(n) is in [0, n), and we know length >= 1
    // because the caller checks before calling. Treat defensively.
    const first = records[0];
    if (first === undefined) {
      throw new Error('pickRandomRecord called with empty records array');
    }
    return first;
  }
  return chosen;
}

/**
 * Strategy identifier exported alongside the implementation for the
 * delegating resolver's strategy map. Re-exported as a constant so
 * future settings-side UIs (web admin) can introspect the full set
 * without re-declaring the literal.
 */
export const DNS_ROUND_ROBIN_STRATEGY: OrchestratorIpResolverStrategy =
  'dns_round_robin';
