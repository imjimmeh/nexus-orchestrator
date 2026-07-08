import { NotFoundException } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { PiSessionTreeRepository } from '../../runtime/database/repositories/pi-session-tree.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowHostMountRuntimeDiagnosticsService } from '../workflow-host-mount/workflow-host-mount-runtime-diagnostics.service';
import { WorkflowSkillRuntimeDiagnosticsService } from '../workflow-skill-runtime-diagnostics.service';
import { WorkflowFailureEvidenceCollectorService } from './workflow-failure-evidence.collector';

function buildService(
  overrides: {
    workflowRunRepository?: Partial<IWorkflowRunRepository>;
    eventLedger?: Partial<EventLedgerService>;
    piSessionTrees?: Partial<PiSessionTreeRepository>;
    skillDiagnostics?: Partial<WorkflowSkillRuntimeDiagnosticsService>;
    hostMountDiagnostics?: Partial<WorkflowHostMountRuntimeDiagnosticsService>;
  } = {},
) {
  return new WorkflowFailureEvidenceCollectorService(
    {
      findById: vi.fn().mockResolvedValue({
        id: 'run-1',
        workflow_id: 'workflow-1',
        current_step_id: 'job-1',
        state_variables: {},
      }),
      ...overrides.workflowRunRepository,
    } as unknown as IWorkflowRunRepository,
    {
      query: vi.fn().mockResolvedValue({ events: [], total: 0 }),
      ...overrides.eventLedger,
    } as unknown as EventLedgerService,
    {
      findByWorkflowRunId: vi.fn().mockResolvedValue(null),
      ...overrides.piSessionTrees,
    } as unknown as PiSessionTreeRepository,
    {
      getRunSkillMountDiagnostics: vi
        .fn()
        .mockResolvedValue({ containers: [] }),
      ...overrides.skillDiagnostics,
    } as unknown as WorkflowSkillRuntimeDiagnosticsService,
    {
      getRunHostMountDiagnostics: vi.fn().mockResolvedValue({ containers: [] }),
      ...overrides.hostMountDiagnostics,
    } as unknown as WorkflowHostMountRuntimeDiagnosticsService,
  );
}

describe('WorkflowFailureEvidenceCollectorService', () => {
  it('throws when workflow run is absent', async () => {
    const service = buildService({
      workflowRunRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.collect('missing-run')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('normalizes event ledger rows and selected job output', async () => {
    const eventLedger = {
      query: vi.fn().mockResolvedValue({
        events: [
          {
            id: 'event-1',
            domain: 'workflow',
            event_name: 'job.failed',
            outcome: 'failure',
            severity: 'error',
            workflow_run_id: 'run-1',
            job_id: 'job-1',
            step_id: 'step-1',
            payload: { command: 'npm test' },
            error_code: 'MODULE_NOT_FOUND',
            error_message: 'Cannot find module left-pad',
            occurred_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        total: 1,
      }),
    };
    const service = buildService({
      eventLedger,
      workflowRunRepository: {
        findById: vi.fn().mockResolvedValue({
          id: 'run-1',
          workflow_id: 'workflow-1',
          current_step_id: 'job-1',
          state_variables: {
            jobs: {
              'job-1': {
                output: { stderr: 'Cannot find module left-pad' },
              },
            },
          },
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(eventLedger.query).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      limit: 100,
    });
    expect(evidence.events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        name: 'job.failed',
        errorCode: 'MODULE_NOT_FOUND',
        errorMessage: 'Cannot find module left-pad',
      }),
    ]);
    expect(evidence.jobOutput).toEqual({
      stderr: 'Cannot find module left-pad',
    });
    expect(evidence.errorCode).toBe('MODULE_NOT_FOUND');
    expect(evidence.errorMessage).toBe('Cannot find module left-pad');
  });

  it('ignores non-record job output and returns null jobOutput', async () => {
    const service = buildService({
      workflowRunRepository: {
        findById: vi.fn().mockResolvedValue({
          id: 'run-1',
          workflow_id: 'workflow-1',
          current_step_id: 'job-1',
          state_variables: {
            jobs: {
              'job-1': {
                output: 'plain text output is not normalized evidence',
              },
            },
          },
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.jobOutput).toBeNull();
  });

  it('resolves job ID from event evidence when current step ID is absent', async () => {
    const service = buildService({
      workflowRunRepository: {
        findById: vi.fn().mockResolvedValue({
          id: 'run-1',
          workflow_id: 'workflow-1',
          state_variables: {},
        }),
      },
      eventLedger: {
        query: vi.fn().mockResolvedValue({
          events: [
            {
              id: 'event-1',
              domain: 'workflow',
              event_name: 'job.failed',
              outcome: 'failure',
              severity: 'error',
              workflow_run_id: 'run-1',
              job_id: 'job-from-event',
              occurred_at: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          total: 1,
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.jobId).toBe('job-from-event');
  });

  it('selects the first non-empty error code and message from multiple events', async () => {
    const service = buildService({
      eventLedger: {
        query: vi.fn().mockResolvedValue({
          events: [
            {
              id: 'event-1',
              domain: 'workflow',
              event_name: 'job.started',
              outcome: 'in_progress',
              severity: 'info',
              workflow_run_id: 'run-1',
              occurred_at: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
              id: 'event-2',
              domain: 'workflow',
              event_name: 'job.failed',
              outcome: 'failure',
              severity: 'error',
              workflow_run_id: 'run-1',
              error_code: 'FIRST_CODE',
              error_message: 'first failure message',
              occurred_at: new Date('2026-01-01T00:00:01.000Z'),
            },
            {
              id: 'event-3',
              domain: 'workflow',
              event_name: 'job.failed.again',
              outcome: 'failure',
              severity: 'error',
              workflow_run_id: 'run-1',
              error_code: 'SECOND_CODE',
              error_message: 'second failure message',
              occurred_at: new Date('2026-01-01T00:00:02.000Z'),
            },
          ],
          total: 3,
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.errorCode).toBe('FIRST_CODE');
    expect(evidence.errorMessage).toBe('first failure message');
  });

  it('adds transcript references from failure-like JSONL without storing raw transcript text', async () => {
    const rawTranscript = 'Exception: secret raw transcript failure details';
    const service = buildService({
      piSessionTrees: {
        findByWorkflowRunId: vi.fn().mockResolvedValue({
          id: 'tree-1',
          jsonl_data: [
            { type: 'message', text: 'ordinary progress' },
            { type: 'assistant', is_error: true, message: rawTranscript },
            JSON.stringify({ type: 'tool', text: 'tool failed with exit 1' }),
          ],
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.transcriptReferences).toEqual([
      expect.objectContaining({
        sessionTreeId: 'tree-1',
        eventIndex: 1,
        kind: 'session_tree',
      }),
      expect.objectContaining({
        sessionTreeId: 'tree-1',
        eventIndex: 2,
        kind: 'session_tree',
      }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain(rawTranscript);
  });

  it('uses safe metadata-only summaries for regex-detected transcript failures', async () => {
    const service = buildService({
      piSessionTrees: {
        findByWorkflowRunId: vi.fn().mockResolvedValue({
          id: 'tree-1',
          jsonl_data: [
            JSON.stringify({
              type: 'tool_result',
              text: 'tool failed with API_KEY=sk-secret and password=hunter2',
            }),
          ],
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.transcriptReferences).toEqual([
      {
        kind: 'session_tree',
        sessionTreeId: 'tree-1',
        eventIndex: 0,
        summary: 'Transcript entry matched failure signal: string',
      },
    ]);
    expect(JSON.stringify(evidence.transcriptReferences)).not.toContain(
      'API_KEY=sk-secret',
    );
    expect(JSON.stringify(evidence.transcriptReferences)).not.toContain(
      'password',
    );
    expect(JSON.stringify(evidence.transcriptReferences)).not.toContain(
      'hunter2',
    );
  });

  it('adds transcript references from production gzip/base64 JSONL payloads', async () => {
    const jsonl = [
      JSON.stringify({ type: 'message', text: 'ordinary progress' }),
      JSON.stringify({
        type: 'assistant',
        is_error: true,
        message: 'Exception: encoded transcript failure details',
      }),
    ].join('\n');
    const encodedJsonl = gzipSync(Buffer.from(jsonl, 'utf-8')).toString(
      'base64',
    );
    const service = buildService({
      piSessionTrees: {
        findByWorkflowRunId: vi.fn().mockResolvedValue({
          id: 'tree-1',
          jsonl_data: [encodedJsonl],
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.transcriptReferences).toEqual([
      {
        kind: 'session_tree',
        sessionTreeId: 'tree-1',
        eventIndex: 1,
        summary: 'Transcript event marked is_error',
      },
    ]);
  });

  it('keeps diagnostics best-effort and records collection errors', async () => {
    const service = buildService({
      skillDiagnostics: {
        getRunSkillMountDiagnostics: vi
          .fn()
          .mockRejectedValue(new Error('docker unavailable')),
      },
      hostMountDiagnostics: {
        getRunHostMountDiagnostics: vi.fn().mockResolvedValue({
          containers: [{ missingHostPaths: ['G:/missing'] }],
        }),
      },
    });

    const evidence = await service.collect('run-1');

    expect(evidence.runtimeDiagnostics.hostMounts).toEqual({
      containers: [{ missingHostPaths: ['G:/missing'] }],
    });
    expect(evidence.runtimeDiagnostics.collectionErrors).toEqual([
      'skill diagnostics: docker unavailable',
    ]);
  });
});
