import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import type { WorkflowRunEvent } from '../../workflow/workflow-events.types';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { RecordLearningService } from '../learning/record-learning.service';
import { StruggleDetectorService } from './struggle-detector.service';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventLedger> = {}): EventLedger {
  return {
    id: crypto.randomUUID(),
    domain: 'tool',
    event_name: 'tool.execution.completed',
    outcome: 'success',
    severity: 'info',
    source: 'api',
    occurred_at: new Date(),
    ...overrides,
  };
}

function makeFailure(
  tool: string,
  errorCode?: string,
  errorMessage?: string,
  payload?: Record<string, unknown>,
): EventLedger {
  return makeEvent({
    outcome: 'failure',
    tool_name: tool,
    error_code: errorCode,
    error_message: errorMessage,
    payload,
  });
}

function makeSuccess(
  tool: string,
  payload?: Record<string, unknown>,
): EventLedger {
  return makeEvent({
    outcome: 'success',
    tool_name: tool,
    payload,
  });
}

type EventLedgerRepoMock = Pick<EventLedgerRepository, 'query'>;
type RecordLearningMock = Pick<RecordLearningService, 'recordLearning'>;

function makeWorkflowRunEvent(
  overrides: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    workflowRunId: 'run-uuid-1',
    workflowId: 'workflow-1',
    status: WorkflowStatus.COMPLETED,
    stateVariables: {
      trigger: { scopeId: 'scope-abc', agent_profile: 'senior_dev' },
    },
    ...overrides,
  };
}

// ── Tests: pure span-detection logic (detectSpans) ───────────────────────────

describe('StruggleDetectorService.detectSpans (pure logic)', () => {
  let service: StruggleDetectorService;

  beforeEach(() => {
    service = new StruggleDetectorService(
      {} as EventLedgerRepository,
      {} as RecordLearningService,
    );
  });

  it('detects a struggle span when ≥2 failures on the same tool are followed by a success', () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_NONZERO', 'permission denied'),
      makeFailure('run_command', 'EXIT_NONZERO', 'permission denied'),
      makeSuccess('run_command'),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual(
      expect.objectContaining({
        tool: 'run_command',
        failedAttempts: expect.arrayContaining([
          expect.objectContaining({ errorCode: 'EXIT_NONZERO' }),
        ]),
      }),
    );
    expect(spans[0]?.failedAttempts).toHaveLength(2);
    expect(spans[0]?.recoveringCall).toBeDefined();
    expect(spans[0]?.errorCodes).toContain('EXIT_NONZERO');
  });

  it('does NOT detect a span when only one failure precedes a success', () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_NONZERO'),
      makeSuccess('run_command'),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(0);
  });

  it('does NOT detect a span when failures on DIFFERENT tools (no single tool has ≥2 failures before success)', () => {
    const events: EventLedger[] = [
      makeFailure('read_file', 'ENOENT'),
      makeFailure('write_file', 'EPERM'),
      makeSuccess('run_command'),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(0);
  });

  it('does NOT detect a span when there are ≥2 failures but no subsequent success on that tool', () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_NONZERO'),
      makeFailure('run_command', 'EXIT_NONZERO'),
      makeSuccess('read_file'),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(0);
  });

  it('detects spans independently for two different tools that each struggle-then-recover', () => {
    const events: EventLedger[] = [
      makeFailure('read_file', 'ENOENT'),
      makeFailure('read_file', 'ENOENT'),
      makeSuccess('read_file'),
      makeFailure('run_command', 'EXIT_1'),
      makeFailure('run_command', 'EXIT_1'),
      makeFailure('run_command', 'EXIT_1'),
      makeSuccess('run_command'),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(2);
    const tools = spans.map((s) => s.tool).sort();
    expect(tools).toEqual(['read_file', 'run_command']);
    const runSpan = spans.find((s) => s.tool === 'run_command');
    expect(runSpan?.failedAttempts).toHaveLength(3);
  });

  it('captures error_code, error_message and payload from failed events', () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'EACCES', 'operation not permitted', {
        command: 'chmod 777 /etc/passwd',
      }),
      makeFailure('bash', 'EACCES', 'operation not permitted', {
        command: 'chmod 777 /root',
      }),
      makeSuccess('bash', { command: 'chmod 644 ./local-file.txt' }),
    ];

    const spans = service.detectSpans(events);

    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.failedAttempts[0]).toEqual(
      expect.objectContaining({
        errorCode: 'EACCES',
        errorMessage: 'operation not permitted',
        payload: { command: 'chmod 777 /etc/passwd' },
      }),
    );
    expect(span.recoveringCall.payload).toEqual({
      command: 'chmod 644 ./local-file.txt',
    });
  });

  it('only emits ONE span per tool even when multiple failure-then-success windows exist', () => {
    // Two separate clusters of failures on the same tool
    const events: EventLedger[] = [
      makeFailure('run_command', 'ERR_A'),
      makeFailure('run_command', 'ERR_A'),
      makeSuccess('run_command'),
      makeFailure('run_command', 'ERR_B'),
      makeFailure('run_command', 'ERR_B'),
      makeSuccess('run_command'),
    ];

    const spans = service.detectSpans(events);

    // One span per tool (we pick the first window per the spec)
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tool).toBe('run_command');
  });

  it('returns an empty array for an empty event list', () => {
    expect(service.detectSpans([])).toEqual([]);
  });

  it('returns an empty array when all events are successes', () => {
    const events: EventLedger[] = [
      makeSuccess('run_command'),
      makeSuccess('read_file'),
    ];
    expect(service.detectSpans(events)).toEqual([]);
  });
});

// ── Tests: async detect(runId) ────────────────────────────────────────────────

describe('StruggleDetectorService.detect(runId)', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let service: StruggleDetectorService;

  beforeEach(() => {
    queryFn = vi.fn();
    service = new StruggleDetectorService(
      { query: queryFn } as unknown as EventLedgerRepository,
      {} as RecordLearningService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries the event_ledger with domain=tool, event_name=tool.execution.completed, sorted ASC, for the run', async () => {
    queryFn.mockResolvedValue([[], 0]);

    await service.detect('run-abc');

    expect(queryFn).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'tool',
        event_name: 'tool.execution.completed',
        workflow_run_id: 'run-abc',
        sort_by: 'occurred_at',
        sort_dir: 'asc',
      }),
    );
  });

  it('returns [] WITHOUT querying the ledger when runId is missing', async () => {
    // Regression for the 2026-06-29 wedge: a falsy runId previously scanned the
    // global last-1000 tool events because the repo drops a falsy filter.
    const spans = await service.detect('');

    expect(spans).toEqual([]);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('returns struggle spans detected from the queried events', async () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'ERR'),
      makeFailure('run_command', 'ERR'),
      makeSuccess('run_command'),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    const spans = await service.detect('run-abc');

    expect(spans).toHaveLength(1);
    expect(spans[0]?.tool).toBe('run_command');
  });

  it('returns an empty array when no struggle spans are found', async () => {
    queryFn.mockResolvedValue([[], 0]);

    const spans = await service.detect('run-abc');

    expect(spans).toHaveLength(0);
  });
});

// ── Tests: WORKFLOW_RUN_COMPLETED_EVENT listener ──────────────────────────────

describe('StruggleDetectorService.handleWorkflowRunCompleted', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let recordLearning: ReturnType<typeof vi.fn>;
  let service: StruggleDetectorService;

  beforeEach(() => {
    queryFn = vi.fn().mockResolvedValue([[], 0]);
    recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'cand-1',
      created: true,
      fingerprint: 'fp-1',
    });
    service = new StruggleDetectorService(
      { query: queryFn } as unknown as EventLedgerRepository,
      { recordLearning } as unknown as RecordLearningService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes ONE struggle candidate when the run has ≥1 struggle span', async () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: 'npm test',
      }),
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: 'npm test',
      }),
      makeSuccess('run_command', { command: 'npx vitest run' }),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    expect(recordLearning).toHaveBeenCalledTimes(1);
  });

  it('writes the candidate with candidate_type=struggle and source_tool=struggle_detector via options', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    const call = recordLearning.mock.calls[0];
    const options = call?.[2];
    expect(options).toEqual(
      expect.objectContaining({
        candidateType: 'struggle',
        sourceTool: 'struggle_detector',
      }),
    );
  });

  it('includes struggle_backed tag in the candidate tags', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    const call = recordLearning.mock.calls[0];
    const params = call?.[1];
    expect(params?.tags).toContain('struggle_backed');
  });

  it('includes failed attempt evidence and recovering call in the candidate evidence', async () => {
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: 'npm test',
      }),
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: 'npm test',
      }),
      makeSuccess('run_command', { command: 'npx vitest run' }),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    const call = recordLearning.mock.calls[0];
    const params = call?.[1];
    const evidence: Array<{ kind: string; summary: string }> =
      params?.evidence ?? [];
    expect(evidence.length).toBeGreaterThan(0);
    // Evidence must carry the struggle details (serialised as summary)
    const allSummaries = evidence.map((e) => e.summary).join(' ');
    expect(allSummaries).toContain('run_command');
    expect(allSummaries).toContain('EXIT_1');
  });

  it('keeps the recovering command in evidence even when failed-attempt payloads are huge', async () => {
    // Each failed attempt carries a payload large enough to blow past the
    // evidence cap on its own; the recovering command must still survive.
    const hugeCommand = `npm test ${'x'.repeat(2000)}`;
    const events: EventLedger[] = [
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: hugeCommand,
      }),
      makeFailure('run_command', 'EXIT_1', 'exit code 1', {
        command: hugeCommand,
      }),
      makeSuccess('run_command', { command: 'npx vitest run --filter foo' }),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    const call = recordLearning.mock.calls[0];
    const params = call?.[1];
    const evidence: Array<{ summary: string }> = params?.evidence ?? [];
    const summary = evidence[0]?.summary ?? '';
    // The actionable recovering command must survive truncation.
    expect(summary).toContain('npx vitest run --filter foo');
    // The high-value header fields survive too.
    expect(summary).toContain('EXIT_1');
    expect(summary).toContain('run_command');
  });

  it('resolves scope_id from stateVariables.trigger.scopeId', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);
    const event = makeWorkflowRunEvent({
      stateVariables: { trigger: { scopeId: 'scope-xyz' } },
    });

    await service.handleWorkflowRunCompleted(event);

    const call = recordLearning.mock.calls[0];
    const params = call?.[1];
    expect(params?.scope_id).toBe('scope-xyz');
  });

  it('resolves scope_id from snake_case trigger.scope_id fallback', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);
    const event = makeWorkflowRunEvent({
      stateVariables: { trigger: { scope_id: 'scope-snake' } },
    });

    await service.handleWorkflowRunCompleted(event);

    const call = recordLearning.mock.calls[0];
    const params = call?.[1];
    expect(params?.scope_id).toBe('scope-snake');
  });

  it('skips writing when scope_id cannot be resolved', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);
    const event = makeWorkflowRunEvent({
      stateVariables: { trigger: {} },
    });

    await service.handleWorkflowRunCompleted(event);

    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('does NOT write when the run has no struggle spans', async () => {
    // Only one failure — not enough for a struggle span
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('ignores non-COMPLETED run status events', async () => {
    const event = makeWorkflowRunEvent({ status: WorkflowStatus.FAILED });

    await service.handleWorkflowRunCompleted(event);

    expect(queryFn).not.toHaveBeenCalled();
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('logs and swallows errors thrown during detection', async () => {
    queryFn.mockRejectedValue(new Error('db error'));

    await expect(
      service.handleWorkflowRunCompleted(makeWorkflowRunEvent()),
    ).resolves.toBeUndefined();

    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('logs and swallows errors thrown by recordLearning', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);
    recordLearning.mockRejectedValue(new Error('write failed'));

    await expect(
      service.handleWorkflowRunCompleted(makeWorkflowRunEvent()),
    ).resolves.toBeUndefined();
  });

  it('passes workflowRunId in the context to recordLearning', async () => {
    const events: EventLedger[] = [
      makeFailure('bash', 'ERR'),
      makeFailure('bash', 'ERR'),
      makeSuccess('bash'),
    ];
    queryFn.mockResolvedValue([events, events.length]);

    await service.handleWorkflowRunCompleted(makeWorkflowRunEvent());

    const call = recordLearning.mock.calls[0];
    const context = call?.[0];
    expect(context?.workflowRunId).toBe('run-uuid-1');
    expect(context?.scopeId).toBe('scope-abc');
  });
});
