/**
 * `StruggleDetectorService` — mines a completed workflow run's event ledger
 * for a struggle-then-recovery pattern: ≥2 `failure` outcomes on the SAME
 * `tool_name`, followed by a `success` on that tool.  When such a pattern is
 * found the service writes ONE evidence-backed `learning_candidate` with
 * `candidate_type='struggle'` so that future agents can learn how to recover
 * from a specific class of tool failure.
 *
 * Detection contract:
 *   - Source: `event_ledger` rows where `domain='tool'` and
 *     `event_name='tool.execution.completed'`, ordered by `occurred_at ASC`.
 *   - A `StruggleSpan` is emitted per `tool_name` whose chronological event
 *     sequence contains ≥2 consecutive `failure` rows followed by at least one
 *     `success`.  Only the FIRST such window per tool is captured (the agent
 *     figured it out; repeating clusters are noise).
 *   - Evidence carries each failed attempt's `error_code`, `error_message`,
 *     and `payload` (the actual command/input) plus the recovering call.
 *
 * Candidate write:
 *   - Called via `RecordLearningService.recordLearning` using the Task-2
 *     `RecordLearningOptions` seam:
 *       `options.candidateType = 'struggle'`
 *       `options.sourceTool   = 'struggle_detector'`
 *   - Always on — struggle candidates ARE the desirable, evidence-backed
 *     output (it was never gated by the retired templated-emitter switch).
 *   - Scope resolved from `stateVariables.trigger.scopeId` (with snake_case
 *     and top-level fallbacks).
 *
 * Registration: `MemoryModule.providers` (avoids the forwardRef circular dep
 * that lives inside `LearningModule`; `RecordLearningService` is exported by
 * `LearningModule` which `MemoryModule` already imports).
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowStatus } from '@nexus/core';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import { RecordLearningService } from '../learning/record-learning.service';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../../workflow/workflow-events.types';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type {
  FailedAttempt,
  RecoveringCall,
  StruggleSpan,
} from './struggle-detector.types';

export type { FailedAttempt, RecoveringCall, StruggleSpan };

const TOOL_DOMAIN = 'tool';
const TOOL_EXECUTION_COMPLETED_EVENT = 'tool.execution.completed';
const FAILURE_OUTCOME = 'failure';
const SUCCESS_OUTCOME = 'success';
const MIN_FAILURES_FOR_STRUGGLE = 2;
const EVIDENCE_SUMMARY_MAX_LENGTH = 500;
// Upper bound on tool-execution rows scanned per run. A run that saturates this
// is logged so the silent-truncation failure mode is observable; Phase 1 can add
// cursor pagination if real runs approach the cap.
const STRUGGLE_DETECTION_EVENT_LIMIT = 1000;

@Injectable()
export class StruggleDetectorService {
  private readonly logger = new Logger(StruggleDetectorService.name);

  constructor(
    private readonly eventLedgerRepository: EventLedgerRepository,
    private readonly recordLearningService: RecordLearningService,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowRunCompleted(event: WorkflowRunEvent): Promise<void> {
    if (event.status !== WorkflowStatus.COMPLETED) {
      return;
    }
    try {
      await this.processCompletedRun(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `StruggleDetectorService swallowed unhandled error for run ${event.workflowRunId ?? 'unknown'}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Load the run's tool-execution events and return all struggle spans.
   * Public so that callers outside the listener path (e.g. Phase-1 interest
   * gate) can invoke it directly.
   */
  async detect(runId: string): Promise<StruggleSpan[]> {
    // A falsy runId must NOT reach the ledger query: the repository drops a
    // falsy `workflow_run_id` filter, turning this into a global last-1000
    // tool-event scan (the 2026-06-29 event-loop wedge). Nothing to detect.
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      return [];
    }
    const [events] = await this.eventLedgerRepository.query({
      domain: TOOL_DOMAIN,
      event_name: TOOL_EXECUTION_COMPLETED_EVENT,
      workflow_run_id: runId,
      sort_by: 'occurred_at',
      sort_dir: 'asc',
      limit: STRUGGLE_DETECTION_EVENT_LIMIT,
    });
    if (events.length === STRUGGLE_DETECTION_EVENT_LIMIT) {
      this.logger.warn(
        `StruggleDetectorService hit the ${STRUGGLE_DETECTION_EVENT_LIMIT}-event scan cap for run ${runId}; tool-execution history may be truncated and a struggle span could be missed.`,
      );
    }
    return this.detectSpans(events);
  }

  /**
   * Pure span-detection over a fixture or live event array.
   *
   * Groups events by `tool_name` and scans each group's sequence for the
   * first occurrence of ≥2 failures followed by a success.  The chronological
   * order of the input array is authoritative — callers MUST pass events
   * sorted by `occurred_at ASC`.
   */
  detectSpans(events: EventLedger[]): StruggleSpan[] {
    // Preserve chronological order while grouping by tool_name.
    const toolOrder: string[] = [];
    const byTool = new Map<string, EventLedger[]>();

    for (const event of events) {
      if (!event.tool_name) {
        continue;
      }
      if (!byTool.has(event.tool_name)) {
        byTool.set(event.tool_name, []);
        toolOrder.push(event.tool_name);
      }
      const bucket = byTool.get(event.tool_name);
      if (bucket !== undefined) {
        bucket.push(event);
      }
    }

    const spans: StruggleSpan[] = [];

    for (const tool of toolOrder) {
      const toolEvents = byTool.get(tool) ?? [];
      const span = findFirstStruggleWindow(tool, toolEvents);
      if (span !== null) {
        spans.push(span);
      }
    }

    return spans;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async processCompletedRun(event: WorkflowRunEvent): Promise<void> {
    const spans = await this.detect(event.workflowRunId);
    if (spans.length === 0) {
      return;
    }

    const scopeId = resolveScopeId(event.stateVariables);
    if (scopeId === null) {
      this.logger.debug(
        `StruggleDetectorService could not resolve scope_id for run ${event.workflowRunId}; skipping candidate write.`,
      );
      return;
    }

    const lesson = renderLesson(event.workflowRunId, spans);
    const evidence = buildEvidence(event.workflowRunId, spans);

    await this.recordLearningService.recordLearning(
      { workflowRunId: event.workflowRunId, scopeId },
      {
        scope_type: 'project',
        scope_id: scopeId,
        lesson,
        evidence,
        confidence: 0.6,
        tags: ['struggle_backed', 'struggle', 'tool_recovery'],
        provenance: {
          event_name: WORKFLOW_RUN_COMPLETED_EVENT,
          source_service: 'struggle_detector.v1',
          workflow_run_id: event.workflowRunId,
          struggle_tool_count: spans.length,
        },
      },
      {
        candidateType: 'struggle',
        sourceTool: 'struggle_detector',
      },
    );

    this.logger.log(
      `StruggleDetectorService recorded struggle candidate for run ${event.workflowRunId} (${spans.length} span(s): ${spans.map((s) => s.tool).join(', ')}).`,
    );
  }
}

// ── Pure helpers (module-private) ─────────────────────────────────────────────

/**
 * Scan a single tool's chronological event list for the first window where
 * ≥MIN_FAILURES failures are immediately followed by a success.
 *
 * Resets the failure buffer on a success so that only the FIRST window per
 * tool is emitted.
 */
function findFirstStruggleWindow(
  tool: string,
  events: EventLedger[],
): StruggleSpan | null {
  const pendingFailures: EventLedger[] = [];

  for (const event of events) {
    if (event.outcome === FAILURE_OUTCOME) {
      pendingFailures.push(event);
      continue;
    }

    if (
      event.outcome === SUCCESS_OUTCOME &&
      pendingFailures.length >= MIN_FAILURES_FOR_STRUGGLE
    ) {
      return buildSpan(tool, pendingFailures, event);
    }

    // A success after fewer than MIN_FAILURES failures resets the window.
    pendingFailures.length = 0;
  }

  return null;
}

function buildSpan(
  tool: string,
  failures: EventLedger[],
  recovery: EventLedger,
): StruggleSpan {
  const failedAttempts: FailedAttempt[] = failures.map((f) => ({
    errorCode: f.error_code ?? undefined,
    errorMessage: f.error_message ?? undefined,
    payload: f.payload ?? undefined,
  }));

  const errorCodes = [
    ...new Set(
      failures
        .map((f) => f.error_code)
        .filter((code): code is string => typeof code === 'string'),
    ),
  ];

  return {
    tool,
    failedAttempts,
    recoveringCall: { payload: recovery.payload ?? undefined },
    errorCodes,
  };
}

function renderLesson(workflowRunId: string, spans: StruggleSpan[]): string {
  const toolSummaries = spans
    .map((s) => {
      const codes =
        s.errorCodes.length > 0 ? ` (${s.errorCodes.join(', ')})` : '';
      return `${s.tool}${codes} after ${s.failedAttempts.length} failure(s)`;
    })
    .join('; ');
  return `Run ${workflowRunId} recovered from tool struggle(s): ${toolSummaries}.`;
}

function buildEvidence(
  workflowRunId: string,
  spans: StruggleSpan[],
): Array<{ kind: string; id: string; summary: string }> {
  return spans.map((span) => ({
    kind: 'struggle_recovery',
    id: `${workflowRunId}:${span.tool}`,
    summary: buildSpanSummary(span),
  }));
}

/**
 * Serialise a span's evidence so the single most actionable field — the
 * command that finally WORKED — always survives the `EVIDENCE_SUMMARY_MAX_LENGTH`
 * cap. The durable header (tool, error codes, failure count, recovering call)
 * is built first and guaranteed to fit; the bulkier failed-attempt payloads are
 * appended only with whatever budget remains.
 */
function buildSpanSummary(span: StruggleSpan): string {
  const header = {
    tool: span.tool,
    errorCodes: span.errorCodes,
    failureCount: span.failedAttempts.length,
    recoveringCall: span.recoveringCall,
  };
  const headerJson = JSON.stringify(header);
  if (headerJson.length >= EVIDENCE_SUMMARY_MAX_LENGTH) {
    // Even the high-value header overflows; truncate it but keep it valid text.
    return `${headerJson.slice(0, EVIDENCE_SUMMARY_MAX_LENGTH - 3)}...`;
  }

  const remaining = EVIDENCE_SUMMARY_MAX_LENGTH - headerJson.length;
  const failedJson = JSON.stringify({ failedAttempts: span.failedAttempts });
  // Trim the closing brace off the header and the opening brace off the failed
  // block so the two objects merge into one record without re-parsing.
  const headerOpen = headerJson.slice(0, -1);
  const failedTail = failedJson.slice(1);
  const failedFragment =
    failedTail.length <= remaining
      ? failedTail
      : `${failedTail.slice(0, Math.max(remaining - 3, 0))}...`;
  return `${headerOpen},${failedFragment}`;
}

function resolveScopeId(
  stateVariables: Record<string, unknown>,
): string | null {
  const trigger = readRecord(stateVariables.trigger);
  const fromCamel = readNonEmptyString(trigger?.scopeId);
  if (fromCamel !== null) {
    return fromCamel;
  }
  const fromSnake = readNonEmptyString(trigger?.scope_id);
  if (fromSnake !== null) {
    return fromSnake;
  }
  return readNonEmptyString(stateVariables.scopeId);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
