/**
 * `RunTranscriptDigestService` — EPIC-212 Phase-2 Task 4.
 *
 * Compresses a single run's evidence into a small, high-signal, secret-free
 * digest BEFORE the (expensive) retrospective analyst sees it. The digest is
 * the deterministic input contract Task 6's orchestrator feeds to the analyst.
 *
 * Source = `event_ledger` ONLY (the Phase-0 spike chose the append-only,
 * normalized ledger over the base64(gzip(JSONL)) session trees). The service
 * reuses the Phase-0 primitives — `StruggleDetectorService.detect` and a single
 * capped `EventLedgerRepository.query` (same rows the detector loads) — and
 * never re-implements struggle detection, ledger querying, token counting, or
 * redaction.
 *
 * Discipline:
 *   - ANCHOR on struggle. The digest is built AROUND the failed→recovered
 *     windows; the recovering command is preserved verbatim (mirrors the
 *     struggle detector's "keep the command that finally worked").
 *   - TOKEN BOUND. The digest is capped at `retrospective_digest_max_tokens`
 *     (default 4000) via `TokenCounterService.countTokens`. Over budget, the
 *     lowest-signal timeline entries are dropped FIRST; struggle spans, their
 *     recovering calls, and anchored error codes are always preserved.
 *   - REDACT. Every line is secret-scrubbed (`RuntimeFeedbackRedactionService`)
 *     and NUL-stripped before it leaves the boundary — the EPIC rail "never
 *     embed/store credential values".
 *   - CITE. Every line carries its source `event_id`; all referenced ids are
 *     collected into `RunDigest.evidenceEventIds`.
 *   - FAIL-SOFT. Any error returns a minimal event-ledger-only digest
 *     (`truncated: true`) and NEVER throws; a zero-row run returns an
 *     empty-but-valid digest.
 *
 * Scope-neutral: no domain-specific identifiers leave this boundary.
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import type { StruggleSpan } from '../../memory/signals/struggle-detector.types';
import { TokenCounterService } from '../../memory/token-counter.service';
import { RuntimeFeedbackRedactionService } from '../../runtime-feedback/runtime-feedback-redaction.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS,
  RUN_TRANSCRIPT_DIGEST_SETTING_KEYS,
} from './run-transcript-digest.settings.constants';
import { selectTimelineWithinBudget } from './run-transcript-digest.trim';
import type {
  DigestErrorCluster,
  DigestStruggleSpan,
  DigestTimelineEntry,
  RunDigest,
} from './run-transcript-digest.types';

export type {
  DigestErrorCluster,
  DigestStruggleSpan,
  DigestTimelineEntry,
  RunDigest,
};

const TOOL_DOMAIN = 'tool';
const TOOL_EXECUTION_COMPLETED_EVENT = 'tool.execution.completed';
const FAILURE_OUTCOME = 'failure';
const SUCCESS_OUTCOME = 'success';
const UNKNOWN_TOOL = 'unknown';
// Tokenizer model whose tiktoken encoding (cl100k_base) covers modern models.
// No LLM call is made here — this only selects the byte→token estimator.
const DIGEST_TOKEN_MODEL = 'gpt-4';
// Mirrors the struggle detector's cap so a saturated run is observable.
const TOOL_SCAN_LIMIT = 1000;
// Hard ceiling on timeline entries fed to the (tiktoken) token-budget pass.
// Bounds worst-case tokenization work regardless of run volume or payload size
// — defence-in-depth behind the O(log n) trim. Protected (struggle / anchored
// error) entries are never dropped by this cap.
const MAX_TIMELINE_ENTRIES = 400;
// Hard ceiling on a single redacted summary line. A pathological tool payload
// (observed up to ~234 KB) must not inflate the token-count blob. The summary
// is already secret-redacted before truncation, so trimming cannot leak.
const MAX_SUMMARY_CHARS = 1024;

@Injectable()
export class RunTranscriptDigestService {
  private readonly logger = new Logger(RunTranscriptDigestService.name);

  constructor(
    private readonly eventLedger: EventLedgerRepository,
    private readonly struggleDetector: StruggleDetectorService,
    private readonly tokenCounter: TokenCounterService,
    private readonly redaction: RuntimeFeedbackRedactionService,
    private readonly settings: SystemSettingsService,
  ) {}

  /**
   * Build the token-bounded, struggle-anchored digest for a run. Never throws:
   * any error degrades to a minimal `truncated` digest.
   */
  async buildDigest(
    runId: string,
    scopeId: string | null = null,
  ): Promise<RunDigest> {
    // A falsy runId must NOT reach the ledger query: the repository drops a
    // falsy `workflow_run_id` filter, turning a per-run digest into a global
    // last-1000-events scan (the 2026-06-29 event-loop wedge). Fail soft.
    if (!isNonEmptyRunId(runId)) {
      this.logger.warn(
        'RunTranscriptDigestService skipped: build requested with a missing run id (no ledger scan performed).',
      );
      return emptyDigest(runId, scopeId, true);
    }
    try {
      return await this.buildDigestInner(runId, scopeId);
    } catch (error) {
      this.warn(`digest build failed for run ${runId}`, error);
      return emptyDigest(runId, scopeId, true);
    }
  }

  // ── Build pipeline ────────────────────────────────────────────────────────

  private async buildDigestInner(
    runId: string,
    scopeId: string | null,
  ): Promise<RunDigest> {
    const maxTokens = await this.resolveMaxTokens();
    // A ledger throw bubbles to buildDigest's catch (→ minimal truncated
    // digest). Detection is fail-soft to an event-ledger-only digest.
    const events = await this.loadToolEvents(runId);
    const { spans, degraded } = await this.safeDetect(runId);

    const timeline = events.map((event) => this.toTimelineEntry(event));
    const errorClusters = buildErrorClusters(events);
    const struggleSpans = spans.map((span) => this.toDigestSpan(span, events));

    const protectedIds = collectProtectedIds(struggleSpans, errorClusters);

    // Stage 1 — cheap entry-count cap (no tokenization): bounds how many
    // entries the tiktoken pass can ever see, regardless of run volume.
    const capped = selectTimelineWithinBudget(
      timeline,
      protectedIds,
      MAX_TIMELINE_ENTRIES,
      (kept) => kept.length,
    );

    // Stage 2 — token-budget trim over the already-bounded set.
    const measure = (kept: DigestTimelineEntry[]): number =>
      this.tokenCounter.countTokens(
        serializeForCount(runId, scopeId, struggleSpans, errorClusters, kept),
        DIGEST_TOKEN_MODEL,
      );

    const { kept, droppedCount } = selectTimelineWithinBudget(
      capped.kept,
      protectedIds,
      maxTokens,
      measure,
    );

    return {
      runId,
      scopeId,
      struggleSpans,
      toolTimeline: kept,
      errorClusters,
      evidenceEventIds: collectEvidenceIds(struggleSpans, errorClusters, kept),
      truncated: degraded || droppedCount > 0 || capped.droppedCount > 0,
    };
  }

  // ── Mappers ───────────────────────────────────────────────────────────────

  private toTimelineEntry(event: EventLedger): DigestTimelineEntry {
    return {
      eventId: event.id,
      tool: event.tool_name ?? UNKNOWN_TOOL,
      outcome: event.outcome,
      errorCode: nonEmpty(event.error_code) ? event.error_code : undefined,
      summary: this.redactLine(buildRawSummary(event)),
    };
  }

  private toDigestSpan(
    span: StruggleSpan,
    events: EventLedger[],
  ): DigestStruggleSpan {
    const toolEvents = events.filter((event) => event.tool_name === span.tool);
    const failureIds = toolEvents
      .filter((event) => event.outcome === FAILURE_OUTCOME)
      .map((event) => event.id);
    const recoveringId = firstSuccessAfterFailure(toolEvents);
    const evidenceEventIds = distinct([
      ...failureIds,
      ...(recoveringId !== null ? [recoveringId] : []),
    ]);

    return {
      tool: span.tool,
      errorCodes: span.errorCodes,
      failureCount: span.failedAttempts.length,
      recoveringSummary: this.redactLine(buildRecoveringSummary(span)),
      evidenceEventIds,
    };
  }

  // ── Redaction (secret-scrub + NUL-strip) ──────────────────────────────────

  private redactLine(raw: string): string {
    // Redact + NUL-strip FIRST (so truncation can never expose a secret the
    // redactor would have caught), THEN bound the length to keep a single
    // pathological payload from inflating the token-count blob.
    return truncate(
      this.redaction.sanitizeSummary(stripNul(raw)),
      MAX_SUMMARY_CHARS,
    );
  }

  // ── Ledger read (throws → caller's fail-soft) ─────────────────────────────

  private async loadToolEvents(runId: string): Promise<EventLedger[]> {
    const [events] = await this.eventLedger.query({
      domain: TOOL_DOMAIN,
      event_name: TOOL_EXECUTION_COMPLETED_EVENT,
      workflow_run_id: runId,
      sort_by: 'occurred_at',
      sort_dir: 'asc',
      limit: TOOL_SCAN_LIMIT,
    });
    if (events.length === TOOL_SCAN_LIMIT) {
      this.logger.warn(
        `RunTranscriptDigestService hit the ${TOOL_SCAN_LIMIT}-event scan cap for run ${runId}; tool-execution history may be truncated.`,
      );
    }
    return events;
  }

  private async safeDetect(
    runId: string,
  ): Promise<{ spans: StruggleSpan[]; degraded: boolean }> {
    try {
      return {
        spans: await this.struggleDetector.detect(runId),
        degraded: false,
      };
    } catch (error) {
      this.warn(`struggle detection failed for run ${runId}`, error);
      return { spans: [], degraded: true };
    }
  }

  // ── Settings (fail-soft to compiled default) ──────────────────────────────

  private async resolveMaxTokens(): Promise<number> {
    try {
      const value = await this.settings.get<unknown>(
        RUN_TRANSCRIPT_DIGEST_SETTING_KEYS.maxTokens,
        RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens,
      );
      return coercePositive(
        value,
        RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens,
      );
    } catch (error) {
      this.warn('digest max-token resolution failed; using default', error);
      return RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens;
    }
  }

  private warn(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `RunTranscriptDigestService ${context}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

// ── Pure helpers (module-private) ──────────────────────────────────────────────

function emptyDigest(
  runId: string,
  scopeId: string | null,
  truncated: boolean,
): RunDigest {
  return {
    runId,
    scopeId,
    struggleSpans: [],
    toolTimeline: [],
    errorClusters: [],
    evidenceEventIds: [],
    truncated,
  };
}

function buildRawSummary(event: EventLedger): string {
  const parts: string[] = [
    `${event.tool_name ?? UNKNOWN_TOOL} -> ${event.outcome}`,
  ];
  if (nonEmpty(event.error_code)) {
    parts.push(`error_code=${event.error_code}`);
  }
  if (nonEmpty(event.error_message)) {
    parts.push(`error=${event.error_message}`);
  }
  if (event.payload && Object.keys(event.payload).length > 0) {
    parts.push(`payload=${JSON.stringify(event.payload)}`);
  }
  return parts.join(' ');
}

function buildRecoveringSummary(span: StruggleSpan): string {
  const payload = span.recoveringCall.payload;
  return payload && Object.keys(payload).length > 0
    ? `recovered: ${JSON.stringify(payload)}`
    : 'recovered';
}

/** First `success` row that follows at least one `failure` for a tool. */
function firstSuccessAfterFailure(events: EventLedger[]): string | null {
  let sawFailure = false;
  for (const event of events) {
    if (event.outcome === FAILURE_OUTCOME) {
      sawFailure = true;
    } else if (event.outcome === SUCCESS_OUTCOME && sawFailure) {
      return event.id;
    }
  }
  return null;
}

function buildErrorClusters(events: EventLedger[]): DigestErrorCluster[] {
  const clusters = new Map<string, DigestErrorCluster>();
  for (const event of events) {
    if (event.outcome !== FAILURE_OUTCOME || !nonEmpty(event.error_code)) {
      continue;
    }
    const tool = event.tool_name ?? UNKNOWN_TOOL;
    const key = `${tool}::${event.error_code}`;
    const existing = clusters.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.evidenceEventIds.push(event.id);
    } else {
      clusters.set(key, {
        errorCode: event.error_code,
        tool,
        count: 1,
        evidenceEventIds: [event.id],
      });
    }
  }
  return [...clusters.values()];
}

function collectProtectedIds(
  spans: DigestStruggleSpan[],
  clusters: DigestErrorCluster[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const span of spans) {
    span.evidenceEventIds.forEach((id) => ids.add(id));
  }
  for (const cluster of clusters) {
    cluster.evidenceEventIds.forEach((id) => ids.add(id));
  }
  return ids;
}

function collectEvidenceIds(
  spans: DigestStruggleSpan[],
  clusters: DigestErrorCluster[],
  timeline: DigestTimelineEntry[],
): string[] {
  return distinct([
    ...spans.flatMap((span) => span.evidenceEventIds),
    ...clusters.flatMap((cluster) => cluster.evidenceEventIds),
    ...timeline.map((entry) => entry.eventId),
  ]);
}

/** Compact serialization used solely to measure the digest's token cost. */
function serializeForCount(
  runId: string,
  scopeId: string | null,
  spans: DigestStruggleSpan[],
  clusters: DigestErrorCluster[],
  timeline: DigestTimelineEntry[],
): string {
  return JSON.stringify({
    runId,
    scopeId,
    struggleSpans: spans,
    errorClusters: clusters,
    toolTimeline: timeline,
  });
}

function stripNul(value: string): string {
  // Defense-in-depth: this codebase has had NUL-wedge incidents; never let a
  // raw NUL (U+0000) byte into a stored/emitted payload.
  return value.split(String.fromCharCode(0)).join('');
}

/** Bound a string to `max` chars, marking truncation so it reads as partial. */
function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  const ELLIPSIS = '…';
  return value.slice(0, Math.max(max - ELLIPSIS.length, 0)) + ELLIPSIS;
}

/** A run id is usable only when it is a non-empty, non-blank string. */
function isNonEmptyRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && runId.trim().length > 0;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function coercePositive(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}
