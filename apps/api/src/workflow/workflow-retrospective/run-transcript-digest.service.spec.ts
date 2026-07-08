import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import type { StruggleSpan } from '../../memory/signals/struggle-detector.types';
import type { TokenCounterService } from '../../memory/token-counter.service';
import { RuntimeFeedbackRedactionService } from '../../runtime-feedback/runtime-feedback-redaction.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import { RunTranscriptDigestService } from './run-transcript-digest.service';

const RUN_ID = 'run-1';
const SCOPE_ID = 'scope-1';
const NUL = String.fromCharCode(0);

describe('RunTranscriptDigestService', () => {
  let query: ReturnType<typeof vi.fn>;
  let detect: ReturnType<typeof vi.fn>;
  let countTokens: ReturnType<typeof vi.fn>;
  let getSetting: ReturnType<typeof vi.fn>;
  let service: RunTranscriptDigestService;

  beforeEach(() => {
    query = vi.fn().mockResolvedValue([[], 0]);
    detect = vi.fn().mockResolvedValue([]);
    // Default: 1 token per character so small fixtures stay well under cap.
    countTokens = vi.fn((text: string) => text.length);
    getSetting = vi.fn(async (_key: string, fallback: unknown) => fallback);
    service = build();
  });

  afterEach(() => vi.restoreAllMocks());

  function build(): RunTranscriptDigestService {
    return new RunTranscriptDigestService(
      { query } as unknown as EventLedgerRepository,
      { detect } as unknown as StruggleDetectorService,
      { countTokens } as unknown as TokenCounterService,
      new RuntimeFeedbackRedactionService(),
      { get: getSetting } as unknown as SystemSettingsService,
    );
  }

  it('anchors on the struggle span, preserves the recovering command verbatim, and tags every line with an event_id under the cap', async () => {
    detect.mockResolvedValue([
      struggleSpan('run_command', ['TS2307'], { command: 'npm ci' }),
    ]);
    query.mockResolvedValue([
      [
        toolEvent('e1', 'run_command', 'failure', 'TS2307'),
        toolEvent('e2', 'run_command', 'failure', 'TS2307'),
        toolEvent('e3', 'run_command', 'success', null),
      ],
      3,
    ]);
    getSetting = vi.fn(async (key: string, fallback: unknown) =>
      key === 'retrospective_digest_max_tokens' ? 4000 : fallback,
    );
    service = build();

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.struggleSpans).toHaveLength(1);
    expect(digest.struggleSpans[0].tool).toBe('run_command');
    expect(digest.struggleSpans[0].recoveringSummary).toContain('npm ci');
    expect(digest.struggleSpans[0].evidenceEventIds).toEqual(
      expect.arrayContaining(['e1', 'e2', 'e3']),
    );
    // Every timeline line carries a real event id.
    for (const entry of digest.toolTimeline) {
      expect(entry.eventId).toBeTruthy();
    }
    // All referenced ids are aggregated and real (subset of the ledger ids).
    expect(digest.evidenceEventIds).toEqual(
      expect.arrayContaining(['e1', 'e2', 'e3']),
    );
    expect(new Set(digest.evidenceEventIds).size).toBe(
      digest.evidenceEventIds.length,
    );
    // Under the cap → not truncated.
    expect(digest.truncated).toBe(false);
    const tokens = countTokens.mock.results.at(-1)?.value as number;
    expect(tokens).toBeLessThanOrEqual(4000);
  });

  it('drops lowest-signal timeline entries first but preserves struggle + error-code lines when over budget', async () => {
    detect.mockResolvedValue([
      struggleSpan('run_command', ['TS2307'], { command: 'npm ci' }),
    ]);
    query.mockResolvedValue([
      [
        toolEvent('s1', 'read', 'success', null),
        toolEvent('s2', 'read', 'success', null),
        toolEvent('e1', 'run_command', 'failure', 'TS2307'),
        toolEvent('e2', 'run_command', 'failure', 'TS2307'),
        toolEvent('e3', 'run_command', 'success', null),
      ],
      5,
    ]);
    // Force a tiny budget so trimming must happen.
    getSetting = vi.fn(async (key: string, fallback: unknown) =>
      key === 'retrospective_digest_max_tokens' ? 1 : fallback,
    );
    service = build();

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.truncated).toBe(true);
    const keptIds = digest.toolTimeline.map((entry) => entry.eventId);
    // Anchored failures (protected by the error cluster) survive trimming.
    expect(keptIds).toContain('e1');
    expect(keptIds).toContain('e2');
    // Plain successes are dropped first.
    expect(keptIds).not.toContain('s1');
    expect(keptIds).not.toContain('s2');
  });

  it('returns a minimal truncated digest without throwing when the ledger query throws', async () => {
    query.mockRejectedValue(new Error('ledger offline'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.runId).toBe(RUN_ID);
    expect(digest.scopeId).toBe(SCOPE_ID);
    expect(digest.truncated).toBe(true);
    expect(digest.toolTimeline).toEqual([]);
    expect(digest.struggleSpans).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('redacts a secret-shaped payload and strips NUL bytes from the digest', async () => {
    query.mockResolvedValue([
      [
        toolEventWith('sec', {
          tool_name: 'bash',
          outcome: 'failure',
          payload: { command: 'export password=hunter2' },
        }),
        toolEventWith('nul', {
          tool_name: 'bash',
          outcome: 'failure',
          error_message: `boom${NUL}tail`,
        }),
      ],
      2,
    ]);

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain(NUL);
    expect(serialized).toContain('boomtail');
  });

  it('returns an empty-but-valid digest for a run with zero ledger rows', async () => {
    query.mockResolvedValue([[], 0]);

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.runId).toBe(RUN_ID);
    expect(digest.scopeId).toBe(SCOPE_ID);
    expect(digest.toolTimeline).toEqual([]);
    expect(digest.struggleSpans).toEqual([]);
    expect(digest.errorClusters).toEqual([]);
    expect(digest.evidenceEventIds).toEqual([]);
    expect(digest.truncated).toBe(false);
  });

  it('returns an empty truncated digest WITHOUT scanning the ledger when runId is missing', async () => {
    // Regression for the 2026-06-29 wedge: a falsy runId previously fell through
    // to a filter-less ledger query (global last-1000 scan) feeding the digest.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const digest = await service.buildDigest('', SCOPE_ID);

    expect(query).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(digest.scopeId).toBe(SCOPE_ID);
    expect(digest.toolTimeline).toEqual([]);
    expect(digest.truncated).toBe(true);
  });

  it('bounds each timeline summary so a huge payload cannot inflate the token-count blob', async () => {
    const hugePayload = { command: 'x'.repeat(50_000) };
    query.mockResolvedValue([
      [
        toolEventWith('big', {
          tool_name: 'bash',
          outcome: 'success',
          payload: hugePayload,
        }),
      ],
      1,
    ]);

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.toolTimeline).toHaveLength(1);
    // Far below the 50k-char payload — bounded regardless of input size.
    expect(digest.toolTimeline[0].summary.length).toBeLessThanOrEqual(1024);
  });

  it('hard-caps the number of timeline entries fed to tokenization', async () => {
    const events = Array.from({ length: 600 }, (_, i) =>
      toolEvent(`s${i}`, 'read', 'success', null),
    );
    query.mockResolvedValue([events, events.length]);
    // Huge budget so the TOKEN trim keeps everything — isolates the entry cap.
    getSetting = vi.fn(async (key: string, fallback: unknown) =>
      key === 'retrospective_digest_max_tokens' ? 100_000_000 : fallback,
    );
    service = build();

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.toolTimeline.length).toBeLessThan(events.length);
    expect(digest.toolTimeline.length).toBeLessThanOrEqual(400);
    expect(digest.truncated).toBe(true);
  });

  it('degrades to an event-ledger-only truncated digest when struggle detection throws', async () => {
    detect.mockRejectedValue(new Error('detector offline'));
    query.mockResolvedValue([
      [toolEvent('e1', 'run_command', 'failure', 'TS2307')],
      1,
    ]);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const digest = await service.buildDigest(RUN_ID, SCOPE_ID);

    expect(digest.struggleSpans).toEqual([]);
    expect(digest.toolTimeline.map((entry) => entry.eventId)).toContain('e1');
    expect(digest.truncated).toBe(true);
  });
});

function struggleSpan(
  tool: string,
  errorCodes: string[],
  recoveringPayload?: Record<string, unknown>,
): StruggleSpan {
  return {
    tool,
    failedAttempts: errorCodes.map((errorCode) => ({ errorCode })),
    recoveringCall: { payload: recoveringPayload },
    errorCodes,
  };
}

function toolEvent(
  id: string,
  tool: string,
  outcome: EventLedger['outcome'],
  errorCode: string | null,
): EventLedger {
  return toolEventWith(id, {
    tool_name: tool,
    outcome,
    error_code: errorCode ?? undefined,
  });
}

function toolEventWith(
  id: string,
  overrides: Partial<EventLedger>,
): EventLedger {
  return {
    id,
    domain: 'tool',
    event_name: 'tool.execution.completed',
    outcome: 'success',
    severity: 'info',
    source: 'api',
    occurred_at: new Date(),
    ...overrides,
  };
}
