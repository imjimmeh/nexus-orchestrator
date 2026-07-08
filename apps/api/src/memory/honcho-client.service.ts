import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IMemorySegment } from '@nexus/core';
import type { MemoryType } from './memory-backend.types';
import type {
  HonchoNormalizationContext,
  HonchoRawSegment,
  UnknownMemoryTypePolicy,
} from './honcho-client.types';
import { HonchoTransportContractError } from './honcho-client.errors';

interface HonchoRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

/**
 * Inputs to {@link HonchoClientService.searchPeerMemory} and
 * {@link HonchoClientService.listPeerMemory}.
 *
 * `entityType` and `entityId` are REQUIRED because the read methods
 * synthesize `IMemorySegment` rows from the raw Honcho response and
 * two of the synthesized fields are seeded from them:
 *
 *   - `entity_type` and `entity_id` — copied verbatim onto each row
 *     so downstream consumers (memory_segments table,
 *     `MemoryEvictionReaper`, etc.) can attribute the row to its
 *     provenance scope;
 *   - the synthetic id fallback
 *     `` `${entityType}:${entityId}:${index}` `` — used when the
 *     raw candidate carries no upstream `id`, so the synthesized
 *     segment is still addressable.
 *
 * Without these two fields the synthesizer would have no way to
 * attribute rows and the fallback id would be ambiguous across
 * concurrent calls. Both backend call sites (`getMemorySegments`
 * and `searchMemory`) already have the values in scope, so this
 * is a required-on-the-contract boundary rather than a default.
 */
interface HonchoPeerRequest {
  workspaceId: string;
  peerId: string;
  entityType: string;
  entityId: string;
  query?: string;
  memoryType?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 1;

@Injectable()
export class HonchoClientService {
  private readonly logger = new Logger(HonchoClientService.name);

  /**
   * One-shot guard for the
   * {@link HonchoClientService.unknownMemoryTypePolicy} warning.
   *
   * The env knob `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` accepts a small
   * closed set. When the operator sets it to an unrecognized value
   * (typo) the resolver still returns the safe default
   * `'log-then-history'` so reads do not break, but it also surfaces
   * one `Logger.warn` so the typo is observable. Without this flag
   * every subsequent read would re-emit the same warning and flood
   * the log — the spec for work item 1291ad94 milestone 1 explicitly
   * pins the warning to "exactly one line".
   */
  private warnedUnknownPolicy = false;

  constructor(private readonly configService: ConfigService) {}

  async searchPeerMemory(params: HonchoPeerRequest): Promise<IMemorySegment[]> {
    const rawJson = await this.requestJson({
      method: 'POST',
      path: this.resolveTemplate(
        this.configService.get<string>('HONCHO_SEARCH_PATH_TEMPLATE') ||
          '/peers/{peerId}/search',
        params.peerId,
      ),
      body: {
        workspace_id: params.workspaceId,
        query: params.query || '',
        memory_type: params.memoryType,
      },
    });

    return HonchoClientService.normalizeHonchoResponse(rawJson, {
      entityType: params.entityType,
      entityId: params.entityId,
      unknownMemoryTypePolicy: this.unknownMemoryTypePolicy(),
    });
  }

  async listPeerMemory(params: HonchoPeerRequest): Promise<IMemorySegment[]> {
    const rawJson = await this.requestJson({
      method: 'POST',
      path: this.resolveTemplate(
        this.configService.get<string>('HONCHO_LIST_PATH_TEMPLATE') ||
          '/peers/{peerId}/messages',
        params.peerId,
      ),
      body: {
        workspace_id: params.workspaceId,
        memory_type: params.memoryType,
      },
    });

    return HonchoClientService.normalizeHonchoResponse(rawJson, {
      entityType: params.entityType,
      entityId: params.entityId,
      unknownMemoryTypePolicy: this.unknownMemoryTypePolicy(),
    });
  }

  // -------------------------------------------------------------------------
  // Transport-layer segment normalization helpers (work item 1291ad94 M1)
  //
  // These six static helpers, together with the private
  // `unknownMemoryTypePolicy` resolver below, are introduced in
  // milestone 1 of the Honcho transport normalization refactor. They
  // are PUBLIC STATICS so future callers (services, controllers,
  // tests) can invoke them without instantiating the full
  // `HonchoClientService` NestJS provider — particularly important for
  // the upcoming M2 deletion in `HonchoMemoryBackendService.normalizeSegments`
  // and any future in-process tests that want to exercise the
  // wire-shape contract without stubbing the whole transport client.
  //
  // The helpers are additive in M1: the original private
  // implementations on `HonchoMemoryBackendService` remain in place
  // unchanged. M2 deletes those duplicates once the backend is wired
  // through the new statics. Logic is preserved verbatim from the
  // legacy inline copies — only the type alias on the wire-shape
  // interface was renamed (HonchoNormalizedMessage → HonchoRawSegment)
  // to reflect that the values flowing in are raw, not normalized.
  // -------------------------------------------------------------------------

  /**
   * Locate the array of candidate rows on a Honcho response payload.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.extractCandidateMessages` verbatim.
   * Recognised response shapes:
   *
   *   - a top-level array (the search/list endpoint returns one
   *     directly today), or
   *   - an object with one of the well-known envelope keys
   *     (`results`, `messages`, `items`, `data`) whose value is an
   *     array.
   *
   * Anything else yields an empty candidate list — the legacy
   * behaviour — so an unexpected envelope shape does not throw.
   */
  public static extractCandidateMessages(
    response: unknown,
  ): HonchoRawSegment[] {
    if (Array.isArray(response)) {
      return response as HonchoRawSegment[];
    }

    if (!response || typeof response !== 'object') {
      return [];
    }

    const container = response as Record<string, unknown>;
    const keys = ['results', 'messages', 'items', 'data'];

    for (const key of keys) {
      const value = container[key];
      if (Array.isArray(value)) {
        return value as HonchoRawSegment[];
      }
    }

    return [];
  }

  /**
   * Read the textual content of a raw Honcho candidate.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.readContent` verbatim. Honcho has
   * historically surfaced the message body under several
   * overlapping keys; this helper probes them in priority order
   * (`content`, `text`, `message`, `body`) and returns the first
   * non-empty, trimmed string. A row whose envelope keys are all
   * empty or non-string returns `null` so the orchestrator can drop
   * it as `null`.
   */
  public static readContent(candidate: HonchoRawSegment): string | null {
    const possible = [
      candidate.content,
      candidate.text,
      candidate.message,
      candidate.body,
    ];

    for (const entry of possible) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        return entry.trim();
      }
    }

    return null;
  }

  /**
   * Resolve a raw Honcho memory type to the closed `MemoryType`
   * union, dispatching on the active `UnknownMemoryTypePolicy`.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.normalizeMemoryType` for the two
   * silent-fallback policies (`'history'` and `'log-then-history'`):
   * any value that does not match `preference | fact | history |
   * strategic_intent` is silently coerced to `'history'` so reads do
   * not break. The new `'throw'` policy turns an unrecognized value
   * into a typed {@link HonchoTransportContractError} carrying
   * `field: 'memory_type'` so callers wiring the strict policy see
   * contract drift as an exception at the boundary instead of a
   * silent coercion deep in the call stack.
   *
   * Both `'history'` and `'log-then-history'` keep today's exact
   * silent-to-history behaviour; the `log` portion of the default
   * policy is reserved for a later milestone (the helper's caller
   * remains responsible for any future audit logging). This makes
   * the additive relocation a pure move — no behaviour change for
   * existing callers.
   */
  public static normalizeMemoryType(
    value: unknown,
    policy: UnknownMemoryTypePolicy,
  ): MemoryType {
    if (
      value === 'preference' ||
      value === 'fact' ||
      value === 'history' ||
      value === 'strategic_intent'
    ) {
      return value;
    }

    if (policy === 'throw') {
      throw new HonchoTransportContractError(
        'memory_type',
        `Honcho response carried unknown memory_type: ${JSON.stringify(value)}; configure HONCHO_UNKNOWN_MEMORY_TYPE_POLICY to 'history' or 'log-then-history' to coerce silently.`,
      );
    }

    return 'history';
  }

  /**
   * Parse an ISO-8601 timestamp on a raw Honcho candidate into a
   * `Date` instance.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.parseDate` verbatim. Strings that do
   * not parse to a finite timestamp fall back to the epoch
   * (`new Date(0)`); any non-string, non-Date value (such as `null`
   * or `undefined`) also falls back to the epoch. This keeps the
   * synthesized `IMemorySegment` row contractually well-formed even
   * when the upstream wire shape is sparse.
   */
  public static parseDate(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return new Date(0);
  }

  /**
   * Synthesise an `IMemorySegment` row from a raw Honcho candidate
   * plus the calling code's attribution context.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.mapCandidate` verbatim, with two
   * additive changes: the wire-shape interface is renamed
   * (`HonchoRawSegment` in lieu of `HonchoNormalizedMessage`) and
   * the active `UnknownMemoryTypePolicy` is threaded through so
   * the strict mode can surface contract drift as a typed
   * exception. Rows whose `readContent` returns `null` are dropped
   * to `null` so the orchestrator's `.filter` step can elide them
   * without an intermediate shape.
   *
   * The synthesized ID falls back to
   * `${entityType}:${entityId}:${index.toString()}` when the row
   * carries no upstream identifier — the legacy behaviour, which
   * keeps the synthesized segments addressable even when Honcho
   * returns no ID.
   */
  public static mapCandidate(
    candidate: HonchoRawSegment,
    params: HonchoNormalizationContext,
    index: number,
    policy: UnknownMemoryTypePolicy,
  ): IMemorySegment | null {
    const content = this.readContent(candidate);
    if (!content) {
      return null;
    }

    const metadataMemoryType =
      candidate.metadata?.memory_type ?? candidate.memory_type;
    const resolvedMemoryType = this.normalizeMemoryType(
      metadataMemoryType,
      policy,
    );

    return {
      id:
        typeof candidate.id === 'string' && candidate.id.trim().length > 0
          ? candidate.id
          : `${params.entityType}:${params.entityId}:${index.toString()}`,
      entity_type: params.entityType,
      entity_id: params.entityId,
      memory_type: resolvedMemoryType,
      content,
      version:
        typeof candidate.version === 'number' && candidate.version > 0
          ? candidate.version
          : 1,
      created_at: this.parseDate(candidate.created_at),
      updated_at: this.parseDate(candidate.updated_at),
    };
  }

  /**
   * Orchestrator: parse a raw Honcho response into an array of
   * `IMemorySegment` rows, attributing each row to the supplied
   * `HonchoNormalizationContext`.
   *
   * Mirrors the legacy
   * `HonchoMemoryBackendService.normalizeSegments` verbatim, modulo
   * the same two additive changes listed on `mapCandidate` above.
   * The active `UnknownMemoryTypePolicy` is taken from the supplied
   * context rather than resolved from environment here — keeping
   * the helper pure makes it trivially testable, and the env knob
   * is resolved one level up via the instance method
   * {@link unknownMemoryTypePolicy}. Empty / non-Honcho-shape
   * responses yield an empty array; rows without readable content
   * are filtered out before the return.
   */
  public static normalizeHonchoResponse(
    rawJson: unknown,
    ctx: HonchoNormalizationContext & {
      unknownMemoryTypePolicy: UnknownMemoryTypePolicy;
    },
  ): IMemorySegment[] {
    const candidates = this.extractCandidateMessages(rawJson);

    return candidates
      .map((entry, index) =>
        this.mapCandidate(entry, ctx, index, ctx.unknownMemoryTypePolicy),
      )
      .filter((segment): segment is IMemorySegment => Boolean(segment));
  }

  /**
   * Resolve the active `UnknownMemoryTypePolicy` for the running
   * process from the `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` env knob.
   *
   * Closed set: `'throw'`, `'history'`, `'log-then-history'`.
   *
   * Default fall-through behaviour:
   *
   *   - Unset / null / undefined / empty string silently resolve to
   *     `'log-then-history'` — the historical behaviour so an
   *     operator who has not configured the knob yet keeps working
   *     without log noise.
   *   - Any other non-empty value (operator typo, formatting
   *     mistake) ALSO resolves to `'log-then-history'` but emits a
   *     single `Logger.warn` line. The flag
   *     {@link warnedUnknownPolicy} ensures the warning fires at
   *     most once per process so a hot read path cannot flood the
   *     log; subsequent calls stay quiet until the process restarts.
   *
   * The warn is intentionally non-blocking — reads stay functional,
   * the typo surfaces to operators, M3 can decide whether to
   * tighten the behaviour further.
   */
  private unknownMemoryTypePolicy(): UnknownMemoryTypePolicy {
    const raw = this.configService.get<string>(
      'HONCHO_UNKNOWN_MEMORY_TYPE_POLICY',
    );

    switch (raw) {
      case 'throw':
        return 'throw';
      case 'history':
        return 'history';
      case 'log-then-history':
        return 'log-then-history';
      default: {
        if (raw && !this.warnedUnknownPolicy) {
          this.warnedUnknownPolicy = true;
          this.logger.warn(
            `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=${JSON.stringify(raw)} is not a recognized value; defaulting to 'log-then-history'. Recognized values: 'throw', 'history', 'log-then-history'.`,
          );
        }
        return 'log-then-history';
      }
    }
  }

  private resolveTemplate(template: string, peerId: string): string {
    return template.replace('{peerId}', encodeURIComponent(peerId));
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>('HONCHO_BASE_URL') ||
      'http://honcho-api:8000'
    ).replace(/\/$/, '');
  }

  private getRetryCount(): number {
    const raw = this.configService.get<string>('HONCHO_RETRY_COUNT');
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed < 0) {
      return DEFAULT_RETRY_COUNT;
    }

    return Math.floor(parsed);
  }

  private getTimeoutMs(): number {
    const raw = this.configService.get<string>('HONCHO_REQUEST_TIMEOUT_MS');
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return DEFAULT_TIMEOUT_MS;
    }

    return Math.floor(parsed);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    const apiKey = this.configService.get<string>('HONCHO_API_KEY');
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private async requestJson(request: HonchoRequest): Promise<unknown> {
    const url = request.path.startsWith('http')
      ? request.path
      : `${this.getBaseUrl()}${request.path}`;

    const retries = this.getRetryCount();
    const timeoutMs = this.getTimeoutMs();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: request.method,
          headers: this.buildHeaders(),
          signal: controller.signal,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `Honcho request failed (${response.status.toString()}): ${errorBody}`,
          );
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          return await response.text();
        }

        return await response.json();
      } catch (error) {
        lastError = error as Error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw (
      lastError || new Error('Honcho request failed with unknown error state')
    );
  }
}
