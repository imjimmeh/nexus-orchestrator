import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import type { StruggleSpan } from '../../memory/signals/struggle-detector.types';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import type {
  IChatSessionMemoryPort,
  IChatSessionRepositoryPort,
} from '../domain-ports';
import { ChatSessionStatus } from '@nexus/core';
import { FAILURE_CLASSIFICATION_AUDIT_EVENT } from '../workflow-repair/failure-classification.types';
import { RetrospectiveGateService } from './retrospective-gate.service';

const TOOL_EVENT = 'tool.execution.completed';

describe('RetrospectiveGateService', () => {
  let detect: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let markStatus: ReturnType<typeof vi.fn>;
  let chatSessionRepo: any;
  let sessionMemory: any;
  let service: RetrospectiveGateService;

  beforeEach(() => {
    detect = vi.fn().mockResolvedValue([]);
    query = vi.fn().mockResolvedValue([[], 0]);
    markStatus = vi.fn().mockResolvedValue(undefined);
    chatSessionRepo = {
      findById: vi.fn(),
    };
    sessionMemory = {
      findRecentBySession: vi.fn(),
    };
    // Settings stub returns the supplied default for every key (defaults path).
    const settings = {
      get: vi.fn(async (_key: string, fallback: unknown) => fallback),
    } as unknown as SystemSettingsService;
    service = new RetrospectiveGateService(
      { detect } as unknown as StruggleDetectorService,
      { query } as unknown as EventLedgerRepository,
      settings,
      { markStatus } as unknown as RetrospectiveQueueRepository,
      chatSessionRepo,
      sessionMemory,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a) scores a recovered-struggle-on-success run high/bypass with the recovering tool in reasons', async () => {
    detect.mockResolvedValue([span('bash', ['ENOENT'])]);
    query.mockResolvedValue([
      [
        toolEvent('evt-1', 'bash', 'failure', 'ENOENT', 0),
        toolEvent('evt-2', 'bash', 'failure', 'ENOENT', 1000),
        toolEvent('evt-3', 'bash', 'success', null, 2000),
      ],
      3,
    ]);

    const result = await service.score(
      queueRow({ terminal_status: 'completed' }),
    );

    expect(['high', 'bypass']).toContain(result.priority);
    expect(result.reasons).toContain('recovered_struggle:bash');
    expect(result.evidenceEventIds).toEqual(
      expect.arrayContaining(['evt-1', 'evt-2', 'evt-3']),
    );
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('(b) floors a bare ambiguous_failure run to the low lane (pathology inverted)', async () => {
    query.mockImplementation((params: { event_name?: string }) =>
      params.event_name === FAILURE_CLASSIFICATION_AUDIT_EVENT
        ? [[classificationEvent('class-evt', 'ambiguous_failure')], 1]
        : [[], 0],
    );

    const result = await service.score(queueRow({ terminal_status: 'failed' }));

    expect(result.priority).toBe('low');
    expect(result.score).toBeLessThanOrEqual(0.4);
    expect(result.reasons).toContain('ambiguous_failure_no_anchor');
  });

  it('(c) scores an anchored failure with a real error_code in the high lane', async () => {
    query.mockImplementation((params: { event_name?: string }) =>
      params.event_name === TOOL_EVENT
        ? [[toolEvent('fail-1', 'run_command', 'failure', 'TS2307', 0)], 1]
        : [[], 0],
    );

    const result = await service.score(queueRow({ terminal_status: 'failed' }));

    expect(result.priority).toBe('high');
    expect(result.reasons).toContain('error_code:TS2307');
    expect(result.evidenceEventIds).toContain('fail-1');
  });

  it('(d) scores a 5-second clean successful run in the low lane', async () => {
    detect.mockResolvedValue([]);
    query.mockResolvedValue([
      [
        toolEvent('ok-1', 'read', 'success', null, 0),
        toolEvent('ok-2', 'read', 'success', null, 5000),
      ],
      2,
    ]);

    const result = await service.score(
      queueRow({ terminal_status: 'completed' }),
    );

    expect(result.priority).toBe('low');
    expect(result.score).toBeLessThanOrEqual(0.4);
  });

  it('(e) derives evidence_event_ids only from ledger rows and never invents them', async () => {
    // A failure WITH an error code (anchoring) and one WITHOUT.
    query.mockImplementation((params: { event_name?: string }) =>
      params.event_name === TOOL_EVENT
        ? [
            [
              toolEvent('anchored', 'run_command', 'failure', 'EISDIR', 0),
              toolEvent('unanchored', 'run_command', 'failure', null, 1000),
            ],
            2,
          ]
        : [[], 0],
    );

    const result = await service.score(queueRow({ terminal_status: 'failed' }));

    // Only the error-coded failure contributes an evidence id; the
    // unanchored row (no diagnostic) does not, and nothing is invented.
    expect(result.evidenceEventIds).toEqual(['anchored']);
  });

  it('(f) degrades to a low score without throwing when the detector throws', async () => {
    detect.mockRejectedValue(new Error('detector offline'));
    query.mockRejectedValue(new Error('ledger offline'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const result = await service.score(
      queueRow({ terminal_status: 'completed' }),
    );

    expect(result.priority).toBe('low');
    expect(result.score).toBeLessThanOrEqual(0.4);
    expect(warn).toHaveBeenCalled();
  });

  it('(g) writes the verdict back via markStatus, preserving prior signals_json keys', async () => {
    detect.mockResolvedValue([span('bash', ['ENOENT'])]);
    query.mockResolvedValue([
      [toolEvent('evt-1', 'bash', 'failure', 'ENOENT', 0)],
      1,
    ]);

    await service.score(
      queueRow({
        id: 'row-9',
        terminal_status: 'completed',
        signals_json: { scope_missing: true },
      }),
    );

    expect(markStatus).toHaveBeenCalledTimes(1);
    const [id, status, patch] = markStatus.mock.calls[0];
    expect(id).toBe('row-9');
    expect(status).toBe('queued');
    expect(patch.interest_score).toBeGreaterThan(0);
    expect(['high', 'bypass']).toContain(patch.priority);
    expect(patch.signals_json).toEqual(
      expect.objectContaining({
        scope_missing: true,
        reasons: expect.arrayContaining(['recovered_struggle:bash']),
        evidence_event_ids: expect.arrayContaining(['evt-1']),
      }),
    );
  });

  it('(h) scores a chat session based on outcome, length, and tool errors', async () => {
    chatSessionRepo.findById.mockResolvedValue({
      id: 'session-123',
      status: ChatSessionStatus.FAILED,
    });
    sessionMemory.findRecentBySession.mockResolvedValue(
      new Array(12).fill({
        id: 'msg-id',
        source_role: 'assistant',
        content: 'error: failed to run command x',
      }),
    );

    const result = await service.score(
      queueRow({
        chat_session_id: 'session-123',
        source_type: 'chat_session',
      }),
    );

    expect(result.priority).toBe('high');
    expect(result.reasons).toContain('failed_session');
    expect(result.reasons).toContain('long_conversation');
    expect(result.reasons).toContain('tool_errors_in_session');
    expect(result.evidenceEventIds).toContain('chat_msg:msg-id');
  });
});

function queueRow(
  overrides: Partial<RetrospectiveQueue> = {},
): RetrospectiveQueue {
  return {
    id: 'row-1',
    workflow_run_id: 'run-1',
    scope_id: 'scope-1',
    terminal_status: 'failed',
    interest_score: 0,
    priority: 'normal',
    status: 'queued',
    signals_json: {},
    enqueued_at: new Date(),
    drained_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function span(tool: string, errorCodes: string[]): StruggleSpan {
  return {
    tool,
    failedAttempts: errorCodes.map((errorCode) => ({ errorCode })),
    recoveringCall: {},
    errorCodes,
  };
}

function toolEvent(
  id: string,
  tool: string,
  outcome: EventLedger['outcome'],
  errorCode: string | null,
  occurredAtMs: number,
): EventLedger {
  return {
    id,
    domain: 'tool',
    event_name: TOOL_EVENT,
    outcome,
    severity: 'info',
    source: 'api',
    tool_name: tool,
    error_code: errorCode ?? undefined,
    occurred_at: new Date(occurredAtMs),
  };
}

function classificationEvent(id: string, failureClass: string): EventLedger {
  return {
    id,
    domain: 'workflow',
    event_name: FAILURE_CLASSIFICATION_AUDIT_EVENT,
    outcome: 'success',
    severity: 'info',
    source: 'api',
    error_code: `failure_classification_${failureClass}`,
    occurred_at: new Date(),
  };
}
