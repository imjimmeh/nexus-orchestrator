import { runtimeFeedbackSignalSchema } from '@nexus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolContractRepairAdapter } from './tool-contract-repair.adapter';

interface MockRuntimeFeedbackIngestionService {
  ingest: ReturnType<typeof vi.fn>;
}

function createAdapter() {
  const eventLedger = {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };
  const runtimeFeedback = {
    ingest: vi.fn().mockResolvedValue({
      groupId: 'group-1',
      candidateId: null,
      promoted: false,
      skippedReason: 'below_threshold',
    }),
  };

  const adapter = new (ToolContractRepairAdapter as unknown as new (
    eventLedger: ConstructorParameters<typeof ToolContractRepairAdapter>[0],
    runtimeFeedback: MockRuntimeFeedbackIngestionService,
  ) => ToolContractRepairAdapter)(
    eventLedger as unknown as ConstructorParameters<
      typeof ToolContractRepairAdapter
    >[0],
    runtimeFeedback,
  );

  return {
    adapter,
    eventLedger,
    runtimeFeedback,
  };
}

describe('ToolContractRepairAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('repairs step_complete reason aliases and strips extra fields', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.repair({
      toolName: 'step_complete',
      payload: {
        summary: 'Blocked by subagent capacity.',
        status: 'blocked',
        reason: 'Maximum concurrent subagents reached.',
        active_subagents: ['subagent-1'],
      },
    });

    expect(result.payload).toEqual({
      summary: 'Blocked by subagent capacity.',
      status: 'blocked',
      reasoning: 'Maximum concurrent subagents reached.',
    });
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'reasoning', originalType: 'string' }),
        expect.objectContaining({ field: 'active_subagents' }),
      ]),
    );
  });

  it('does not map non-string reason to reasoning and strips it', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.repair({
      toolName: 'step_complete',
      payload: {
        summary: 'Blocked.',
        reason: { complex: 'object' },
      },
    });

    expect(result.payload).toEqual({
      summary: 'Blocked.',
    });
    expect(result.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'reason',
          originalType: 'extra_field_stripped',
        }),
      ]),
    );
    expect(result.payload).not.toHaveProperty('reasoning');
  });

  it('repairs stringified set_job_output data objects', async () => {
    const { adapter } = createAdapter();
    const result = await adapter.repair({
      toolName: 'set_job_output',
      payload: {
        data: '{"decision":"accept"}',
      },
    });

    expect(result.payload.data).toEqual({ decision: 'accept' });
    expect(result.repairs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'data' })]),
    );
  });

  it('repairs ask_user_questions args.questions arrays', async () => {
    const { adapter } = createAdapter();
    const result = await adapter.repair({
      toolName: 'ask_user_questions',
      payload: {
        args: {
          questions: '[{"question":"Pick one","options":["a","b"]}]',
        },
      },
    });

    expect(result.payload.args).toEqual({
      questions: [{ question: 'Pick one', options: ['a', 'b'] }],
    });
    expect(
      result.repairs.some((entry) => entry.field === 'args.questions'),
    ).toBe(true);
  });

  it('does not mutate already-valid payloads', async () => {
    const { adapter } = createAdapter();
    const payload = {
      data: { ok: true },
    };

    const result = await adapter.repair({
      toolName: 'set_job_output',
      payload,
    });

    expect(result.payload).toEqual(payload);
    expect(result.repairs).toEqual([]);
  });

  it('repairs legacy set_job_output output alias payloads', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.repair({
      toolName: 'set_job_output',
      payload: {
        output: '{"pm_summary":"done"}',
      },
    });

    expect(result.payload.data).toEqual({ pm_summary: 'done' });
    expect(result.repairs.some((entry) => entry.field === 'data')).toBe(true);
  });

  it('projects top-level set_job_output fields into data', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.repair({
      toolName: 'set_job_output',
      payload: {
        jobId: 'job-1',
        pm_summary: 'done',
        acceptance_clarifications: ['ac-1'],
      },
    });

    expect(result.payload.data).toEqual({
      pm_summary: 'done',
      acceptance_clarifications: ['ac-1'],
    });
    expect(result.repairs.some((entry) => entry.field === 'data')).toBe(true);
  });

  it('ingests sanitized runtime feedback only when repair telemetry exceeds the threshold', async () => {
    const { adapter, runtimeFeedback } = createAdapter();

    for (let index = 0; index < 4; index += 1) {
      await adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-1',
        jobId: 'job-1',
        payload: {
          data: '{"secret":"do-not-store","summary":"done"}',
        },
      });
    }

    expect(runtimeFeedback.ingest).not.toHaveBeenCalled();

    await adapter.repair({
      toolName: 'set_job_output',
      workflowRunId: 'workflow-run-1',
      jobId: 'job-1',
      payload: {
        data: '{"secret":"do-not-store","summary":"done"}',
      },
    });

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );
    const serializedSignal = JSON.stringify(signal);

    expect(signal.signal_type).toBe('tool_contract_repair');
    expect(signal.scope).toEqual({
      scope_type: 'workflow_run',
      scope_id: 'workflow-run-1',
    });
    expect(signal.affected).toEqual(
      expect.objectContaining({
        tool_name: 'set_job_output',
        workflow_run_id: 'workflow-run-1',
        job_id: 'job-1',
        schema_path: 'data',
        failure_class: 'string',
      }),
    );
    expect(signal.dedupe_fingerprint).toContain('set_job_output');
    expect(signal.dedupe_fingerprint).toContain('data');
    expect(signal.dedupe_fingerprint).toContain('string');
    expect(signal.dedupe_fingerprint).toContain('workflow_run:workflow-run-1');
    expect(signal.examples).toEqual([
      {
        summary:
          'Tool set_job_output contract repair exceeded threshold for data (string).',
        redacted: true,
      },
    ]);
    expect(serializedSignal).not.toContain('do-not-store');
    expect(serializedSignal).not.toContain('summary":"done');
  });

  it('does not ingest runtime feedback for below-threshold applied repairs or unrepaired calls', async () => {
    const { adapter, runtimeFeedback } = createAdapter();

    await adapter.repair({
      toolName: 'set_job_output',
      workflowRunId: 'workflow-run-2',
      payload: {
        data: '{"decision":"accept"}',
      },
    });
    await adapter.repair({
      toolName: 'set_job_output',
      workflowRunId: 'workflow-run-2',
      payload: {
        data: { decision: 'accept' },
      },
    });

    expect(runtimeFeedback.ingest).not.toHaveBeenCalled();
  });

  it('preserves repaired tool output when runtime feedback ingestion fails', async () => {
    const { adapter, runtimeFeedback } = createAdapter();
    runtimeFeedback.ingest.mockRejectedValue(new Error('feedback store down'));

    for (let index = 0; index < 4; index += 1) {
      await adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-3',
        payload: {
          data: '{"decision":"accept"}',
        },
      });
    }

    await expect(
      adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-3',
        payload: {
          data: '{"decision":"accept"}',
        },
      }),
    ).resolves.toEqual({
      payload: {
        data: { decision: 'accept' },
      },
      repairs: [
        {
          field: 'data',
          originalType: 'string',
        },
      ],
    });
  });

  it('does not ingest unknown repair feedback for valid calls after a threshold crossing', async () => {
    const { adapter, runtimeFeedback } = createAdapter();

    for (let index = 0; index < 5; index += 1) {
      await adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-4',
        payload: {
          data: '{"decision":"accept"}',
        },
      });
    }

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);

    await adapter.repair({
      toolName: 'set_job_output',
      workflowRunId: 'workflow-run-4',
      payload: {
        data: { decision: 'accept' },
      },
    });

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(runtimeFeedback.ingest.mock.calls)).not.toContain(
      'unknown',
    );
  });

  it('tracks threshold feedback per concrete repair dimension rather than per tool', async () => {
    const { adapter, runtimeFeedback } = createAdapter();

    for (let index = 0; index < 4; index += 1) {
      await adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-5',
        payload: {
          data: '{"decision":"accept"}',
        },
      });
    }

    await adapter.repair({
      toolName: 'set_job_output',
      workflowRunId: 'workflow-run-5',
      payload: {
        data: {
          details: '{"reason":"mixed repair"}',
        },
      },
    });

    expect(runtimeFeedback.ingest).not.toHaveBeenCalled();

    for (let index = 0; index < 4; index += 1) {
      await adapter.repair({
        toolName: 'set_job_output',
        workflowRunId: 'workflow-run-5',
        payload: {
          data: {
            details: '{"reason":"dimension threshold"}',
          },
        },
      });
    }

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(signal.affected).toEqual(
      expect.objectContaining({
        tool_name: 'set_job_output',
        schema_path: 'data.details',
        failure_class: 'string',
      }),
    );
    expect(signal.dedupe_fingerprint).toContain('data.details');
  });
});
