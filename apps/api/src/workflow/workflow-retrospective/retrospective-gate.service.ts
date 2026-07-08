/**
 * `RetrospectiveGateService` — EPIC-212 Phase-2 Task 2.
 *
 * A cheap, deterministic interest scorer that decides WHICH terminal runs are
 * worth an (expensive) LLM retrospective. It runs zero LLM calls and reuses the
 * Phase-0 primitives: `StruggleDetectorService.detect` and a single capped
 * `event_ledger` tool-execution scan (the same rows the detector loads).
 *
 * Signals (all cheap, ledger-backed):
 *   - Recovered-struggle-on-success → highest lane (a working recovery
 *     procedure worth mining). The struggling tool is carried into `reasons`.
 *   - Anchored failure (a real `error_code`, repeated failed command, or
 *     multiple distinct error codes) → high / bypass lane.
 *   - Bare `ambiguous_failure` with NO anchored error code → FLOORED to the
 *     low lane. This inverts the historic pathology where the catch-all
 *     `ambiguous_failure` class was treated as highest-confidence.
 *   - Recognized non-ambiguous failure class → high lane.
 *   - Clean / trivial / duration-outlier success → low lane.
 *
 * The verdict (`interest_score`, `priority`, and a `signals_json` extension
 * carrying `reasons` + `evidence_event_ids`) is written back onto the queue row
 * via `RetrospectiveQueueRepository.markStatus`, PRESERVING any prior
 * `signals_json` keys (e.g. the enqueue listener's `scope_missing`).
 *
 * Scope-neutral: no domain-specific identifiers leave this boundary; evidence
 * ids are ALWAYS real `event_ledger` row ids — never invented.
 *
 * Fail-soft: a detector / ledger / settings error degrades to a low neutral
 * score; the method never throws.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import type { StruggleSpan } from '../../memory/signals/struggle-detector.types';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { FAILURE_CLASSIFICATION_AUDIT_EVENT } from '../workflow-repair/failure-classification.types';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import {
  CHAT_SESSION_MEMORY_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  type IChatSessionMemoryPort,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import { ChatSessionStatus } from '@nexus/core';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import {
  RETROSPECTIVE_GATE_SETTING_DEFAULTS,
  RETROSPECTIVE_GATE_SETTING_KEYS,
} from './retrospective-gate.settings.constants';
import type {
  InterestScore,
  RetrospectivePriority,
} from './retrospective-gate.types';

export type { InterestScore, RetrospectivePriority };

const TOOL_DOMAIN = 'tool';
const TOOL_EXECUTION_COMPLETED_EVENT = 'tool.execution.completed';
const WORKFLOW_DOMAIN = 'workflow';
const FAILURE_OUTCOME = 'failure';
const TERMINAL_STATUS_COMPLETED = 'completed';
const DEFAULT_QUEUE_STATUS = 'queued';
const AMBIGUOUS_FAILURE_CLASS = 'ambiguous_failure';
const FAILURE_CLASSIFICATION_CODE_PREFIX = 'failure_classification_';
// Upper bound on tool-execution rows scanned per run — mirrors the struggle
// detector's cap so a run that saturates it is logged (observable truncation).
const TOOL_SCAN_LIMIT = 1000;

/** Resolved, coerced gate weights/thresholds (one read per scoring pass). */
interface GateSettings {
  struggleScore: number;
  anchoredFailureScore: number;
  recognizedFailureScore: number;
  bypassScore: number;
  ambiguousFloor: number;
  cleanSuccessScore: number;
  bypassThreshold: number;
  highThreshold: number;
  normalThreshold: number;
  bypassDistinctErrorCodes: number;
  repeatedFailureThreshold: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}

@Injectable()
export class RetrospectiveGateService {
  private readonly logger = new Logger(RetrospectiveGateService.name);

  constructor(
    private readonly struggleDetector: StruggleDetectorService,
    private readonly eventLedger: EventLedgerRepository,
    private readonly settings: SystemSettingsService,
    private readonly queue: RetrospectiveQueueRepository,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    @Inject(CHAT_SESSION_MEMORY_PORT)
    private readonly sessionMemory: IChatSessionMemoryPort,
  ) {}

  /**
   * Score one queued retrospective row and persist the verdict back onto it.
   *
   * Returns the {@link InterestScore} so a caller (the enqueue path / drain)
   * can route `priority === 'bypass'` rows to immediate analysis. Never throws.
   */
  async score(row: RetrospectiveQueue): Promise<InterestScore> {
    const settings = await this.resolveSettings();

    let verdict: InterestScore;
    try {
      if (row.source_type === 'chat_session' && row.chat_session_id) {
        verdict = await this.scoreChatSession(row.chat_session_id, settings);
      } else {
        const runId = row.workflow_run_id ?? '';
        verdict =
          row.terminal_status === TERMINAL_STATUS_COMPLETED
            ? await this.scoreCompletedRun(runId, settings)
            : await this.scoreFailedRun(runId, settings);
      }
    } catch (error) {
      this.warn(`score computation failed for row ${row.id}`, error);
      verdict = this.floorVerdict(settings, ['gate_error'], []);
    }

    await this.persist(row, verdict);
    return verdict;
  }

  // ── Scorers ────────────────────────────────────────────────────────────

  private async scoreCompletedRun(
    runId: string,
    settings: GateSettings,
  ): Promise<InterestScore> {
    const events = await this.loadToolEvents(runId);
    const spans = await this.safeDetect(runId);

    if (spans.length > 0) {
      const tools = new Set(spans.map((span) => span.tool));
      const reasons = spans.map((span) => `recovered_struggle:${span.tool}`);
      const evidence = collectEventIdsForTools(events, tools);
      return this.buildVerdict(
        settings.struggleScore,
        settings,
        reasons,
        evidence,
      );
    }

    const reasons = ['clean_success'];
    const durationSeconds = computeActivityDurationSeconds(events);
    if (
      durationSeconds !== null &&
      (durationSeconds < settings.minDurationSeconds ||
        durationSeconds > settings.maxDurationSeconds)
    ) {
      reasons.push('duration_outlier');
    }
    return this.buildVerdict(settings.cleanSuccessScore, settings, reasons, []);
  }

  private async scoreFailedRun(
    runId: string,
    settings: GateSettings,
  ): Promise<InterestScore> {
    const events = await this.loadToolEvents(runId);
    const failedEvents = events.filter(
      (event) => event.outcome === FAILURE_OUTCOME,
    );
    const anchoredFailures = failedEvents.filter((event) =>
      nonEmptyString(event.error_code),
    );

    if (anchoredFailures.length > 0) {
      return this.buildAnchoredFailureVerdict(
        anchoredFailures,
        failedEvents,
        settings,
      );
    }

    const classification = await this.loadFailureClass(runId);
    if (
      classification !== null &&
      classification.failureClass !== null &&
      classification.failureClass !== AMBIGUOUS_FAILURE_CLASS
    ) {
      return this.buildVerdict(
        settings.recognizedFailureScore,
        settings,
        ['recognized_failure', `failure_class:${classification.failureClass}`],
        [classification.eventId],
      );
    }

    // Bare ambiguous_failure (or no classifiable signal) with no anchored
    // error code → the pathology inversion: floor the interest score.
    const evidence =
      classification !== null
        ? [classification.eventId]
        : failedEvents.map((event) => event.id);
    return this.floorVerdict(
      settings,
      ['ambiguous_failure_no_anchor'],
      evidence,
    );
  }

  private buildAnchoredFailureVerdict(
    anchoredFailures: EventLedger[],
    failedEvents: EventLedger[],
    settings: GateSettings,
  ): InterestScore {
    const distinctCodes = distinctStrings(
      anchoredFailures.map((event) => event.error_code),
    );
    const repeatedCommandCount = maxRepeatedPayloadCount(failedEvents);
    const strong =
      distinctCodes.length >= settings.bypassDistinctErrorCodes ||
      repeatedCommandCount >= settings.repeatedFailureThreshold;

    const reasons = [
      'anchored_failure',
      ...distinctCodes.map((code) => `error_code:${code}`),
    ];
    if (repeatedCommandCount >= settings.repeatedFailureThreshold) {
      reasons.push('repeated_failed_command');
    }
    const evidence = anchoredFailures.map((event) => event.id);
    const baseScore = strong
      ? settings.bypassScore
      : settings.anchoredFailureScore;
    return this.buildVerdict(baseScore, settings, reasons, evidence);
  }

  // ── Verdict builders ─────────────────────────────────────────────────────

  private buildVerdict(
    score: number,
    settings: GateSettings,
    reasons: string[],
    evidenceEventIds: string[],
  ): InterestScore {
    return {
      score,
      priority: toPriority(score, settings),
      reasons,
      evidenceEventIds: distinctStrings(evidenceEventIds),
    };
  }

  private floorVerdict(
    settings: GateSettings,
    reasons: string[],
    evidenceEventIds: string[],
  ): InterestScore {
    return this.buildVerdict(
      settings.ambiguousFloor,
      settings,
      reasons,
      evidenceEventIds,
    );
  }

  // ── Ledger / detector reads (fail-soft) ──────────────────────────────────

  private async safeDetect(runId: string): Promise<StruggleSpan[]> {
    try {
      return await this.struggleDetector.detect(runId);
    } catch (error) {
      this.warn(`struggle detection failed for run ${runId}`, error);
      return [];
    }
  }

  private async loadToolEvents(runId: string): Promise<EventLedger[]> {
    try {
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
          `RetrospectiveGateService hit the ${TOOL_SCAN_LIMIT}-event scan cap for run ${runId}; tool-execution history may be truncated.`,
        );
      }
      return events;
    } catch (error) {
      this.warn(`tool-event load failed for run ${runId}`, error);
      return [];
    }
  }

  private async loadFailureClass(
    runId: string,
  ): Promise<{ failureClass: string | null; eventId: string } | null> {
    try {
      const [events] = await this.eventLedger.query({
        domain: WORKFLOW_DOMAIN,
        event_name: FAILURE_CLASSIFICATION_AUDIT_EVENT,
        workflow_run_id: runId,
        sort_by: 'occurred_at',
        sort_dir: 'desc',
        limit: 1,
      });
      const latest = events[0];
      if (latest === undefined) {
        return null;
      }
      return {
        failureClass: parseFailureClass(latest.error_code),
        eventId: latest.id,
      };
    } catch (error) {
      this.warn(`failure-classification load failed for run ${runId}`, error);
      return null;
    }
  }

  // ── Persistence (fail-soft) ──────────────────────────────────────────────

  private async persist(
    row: RetrospectiveQueue,
    verdict: InterestScore,
  ): Promise<void> {
    try {
      const signalsJson: Record<string, unknown> = {
        ...(row.signals_json ?? {}),
        reasons: verdict.reasons,
        evidence_event_ids: verdict.evidenceEventIds,
      };
      await this.queue.markStatus(row.id, row.status ?? DEFAULT_QUEUE_STATUS, {
        interest_score: verdict.score,
        priority: verdict.priority,
        signals_json: signalsJson,
      });
    } catch (error) {
      this.warn(`verdict persist failed for run ${row.workflow_run_id}`, error);
    }
  }

  // ── Settings (fail-soft to compiled defaults) ────────────────────────────

  private async resolveSettings(): Promise<GateSettings> {
    try {
      const read = async (key: string, fallback: number): Promise<number> =>
        coerceNumber(await this.settings.get<unknown>(key, fallback), fallback);
      const keys = RETROSPECTIVE_GATE_SETTING_KEYS;
      const d = RETROSPECTIVE_GATE_SETTING_DEFAULTS;
      return {
        struggleScore: await read(keys.struggleScore, d.struggleScore),
        anchoredFailureScore: await read(
          keys.anchoredFailureScore,
          d.anchoredFailureScore,
        ),
        recognizedFailureScore: await read(
          keys.recognizedFailureScore,
          d.recognizedFailureScore,
        ),
        bypassScore: await read(keys.bypassScore, d.bypassScore),
        ambiguousFloor: await read(keys.ambiguousFloor, d.ambiguousFloor),
        cleanSuccessScore: await read(
          keys.cleanSuccessScore,
          d.cleanSuccessScore,
        ),
        bypassThreshold: await read(keys.bypassThreshold, d.bypassThreshold),
        highThreshold: await read(keys.highThreshold, d.highThreshold),
        normalThreshold: await read(keys.normalThreshold, d.normalThreshold),
        bypassDistinctErrorCodes: await read(
          keys.bypassDistinctErrorCodes,
          d.bypassDistinctErrorCodes,
        ),
        repeatedFailureThreshold: await read(
          keys.repeatedFailureThreshold,
          d.repeatedFailureThreshold,
        ),
        minDurationSeconds: await read(
          keys.minDurationSeconds,
          d.minDurationSeconds,
        ),
        maxDurationSeconds: await read(
          keys.maxDurationSeconds,
          d.maxDurationSeconds,
        ),
      };
    } catch (error) {
      this.warn('settings resolution failed; using compiled defaults', error);
      return { ...RETROSPECTIVE_GATE_SETTING_DEFAULTS };
    }
  }

  private async scoreChatSession(
    sessionId: string,
    settings: GateSettings,
  ): Promise<InterestScore> {
    const session = await this.chatSessionRepo.findById(sessionId);
    if (!session) {
      return this.floorVerdict(settings, ['session_not_found'], []);
    }

    const messages = await this.sessionMemory.findRecentBySession(
      sessionId,
      100,
    );
    const reasons: string[] = [];
    let score = settings.cleanSuccessScore; // starts low

    if (session.status === ChatSessionStatus.FAILED) {
      score = settings.recognizedFailureScore; // higher for failed sessions
      reasons.push('failed_session');
    }

    if (messages.length >= 10) {
      score += 0.1;
      reasons.push('long_conversation');
    }

    const toolErrors = messages.filter(
      (m) =>
        m.source_role === 'assistant' &&
        (m.content.toLowerCase().includes('error:') ||
          m.content.toLowerCase().includes('failed to run') ||
          m.content.toLowerCase().includes('exception occurred')),
    );
    if (toolErrors.length > 0) {
      score += 0.15;
      reasons.push('tool_errors_in_session');
    }

    const finalScore = Math.min(score, settings.struggleScore);
    const evidenceIds = messages.slice(0, 5).map((m) => `chat_msg:${m.id}`);

    return this.buildVerdict(finalScore, settings, reasons, evidenceIds);
  }

  private warn(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `RetrospectiveGateService ${context}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

// ── Pure helpers (module-private) ────────────────────────────────────────────

function toPriority(
  score: number,
  settings: GateSettings,
): RetrospectivePriority {
  if (score >= settings.bypassThreshold) {
    return 'bypass';
  }
  if (score >= settings.highThreshold) {
    return 'high';
  }
  if (score >= settings.normalThreshold) {
    return 'normal';
  }
  return 'low';
}

/** Event ids of every loaded row whose `tool_name` is in the struggling set. */
function collectEventIdsForTools(
  events: EventLedger[],
  tools: Set<string>,
): string[] {
  return events
    .filter(
      (event) => event.tool_name !== undefined && tools.has(event.tool_name),
    )
    .map((event) => event.id);
}

/** Activity span (seconds) between the first and last loaded ledger row. */
function computeActivityDurationSeconds(events: EventLedger[]): number | null {
  if (events.length < 2) {
    return null;
  }
  const first = toMillis(events[0]?.occurred_at);
  const last = toMillis(events[events.length - 1]?.occurred_at);
  if (first === null || last === null || last < first) {
    return null;
  }
  return Math.round((last - first) / 1000);
}

/**
 * Largest count of identical non-empty failed payloads (a repeated failed
 * command). Rows with no payload never count as a repeat.
 */
function maxRepeatedPayloadCount(events: EventLedger[]): number {
  const counts = new Map<string, number>();
  let max = 0;
  for (const event of events) {
    if (event.payload === undefined || event.payload === null) {
      continue;
    }
    const key = JSON.stringify(event.payload);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next > max) {
      max = next;
    }
  }
  return max;
}

function distinctStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => nonEmptyString(value)),
    ),
  ];
}

function parseFailureClass(errorCode: string | undefined): string | null {
  if (!nonEmptyString(errorCode)) {
    return null;
  }
  if (!errorCode.startsWith(FAILURE_CLASSIFICATION_CODE_PREFIX)) {
    return null;
  }
  const parsed = errorCode.slice(FAILURE_CLASSIFICATION_CODE_PREFIX.length);
  return parsed.length > 0 ? parsed : null;
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
