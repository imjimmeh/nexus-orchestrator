import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { StateManagerService } from '../state-manager.service';
import { JobOutputContractResolverService } from './job-output-contract-resolver.service';
import { WorkflowRuntimeSetJobOutputService } from './workflow-runtime-set-job-output.service';
import { WorkflowRuntimeTerminalRunGuardService } from './workflow-runtime-terminal-run-guard.service';

describe('WorkflowRuntimeSetJobOutputService', () => {
  let service: WorkflowRuntimeSetJobOutputService;

  const getVariable = vi.fn();
  const setVariable = vi.fn();
  const emitBestEffort = vi.fn().mockResolvedValue(undefined);
  const assertRunIsActive = vi.fn().mockResolvedValue(undefined);

  const stateManager = {
    getVariable,
    setVariable,
  } as unknown as StateManagerService;

  const eventLedger = {
    emitBestEffort,
  } as unknown as EventLedgerService;

  const terminalRunGuard = {
    assertRunIsActive,
  } as unknown as WorkflowRuntimeTerminalRunGuardService;

  const resolveContract = vi.fn();

  const contractResolver = {
    resolveContract,
  } as unknown as JobOutputContractResolverService;

  beforeEach(() => {
    vi.clearAllMocks();
    assertRunIsActive.mockResolvedValue(undefined);
    resolveContract.mockResolvedValue(null);
    service = new WorkflowRuntimeSetJobOutputService(
      stateManager,
      eventLedger,
      terminalRunGuard,
      contractResolver,
    );
  });

  it('merges output into jobs.{jobId}.output', async () => {
    getVariable.mockResolvedValue({ existing: 1 });

    await service.setJobOutput('run-1', 'job-1', { next: 'value' });

    expect(getVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output');
    expect(setVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output', {
      existing: 1,
      next: 'value',
    });
  });

  it('is idempotent when payload does not change state', async () => {
    getVariable.mockResolvedValue({ key: 'same' });

    await service.setJobOutput('run-1', 'job-1', { key: 'same' });

    expect(setVariable).not.toHaveBeenCalled();
  });

  it('rejects terminal workflow runs before persisting output', async () => {
    assertRunIsActive.mockRejectedValueOnce(
      new ConflictException(
        'Workflow run run-1 has terminal status FAILED; set_job_output is not allowed',
      ),
    );

    await expect(
      service.setJobOutput('run-1', 'job-1', { summary: 'late' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.rejected',
        errorCode: 'set_job_output_terminal_run',
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    );
    expect(setVariable).not.toHaveBeenCalled();
  });

  it('rejects reserved identity keys in output data', async () => {
    await expect(
      service.setJobOutput('run-1', 'job-1', {
        workflow_run_id: 'other-run',
        pm_summary: 'ok',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.rejected',
        errorCode: 'set_job_output_reserved_keys',
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    );
    expect(setVariable).not.toHaveBeenCalled();
  });

  it('rejects non-object payloads with a bad request instead of crashing', async () => {
    await expect(
      service.setJobOutput(
        'run-1',
        'job-1',
        undefined as unknown as Record<string, unknown>,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.rejected',
        errorCode: 'set_job_output_invalid_data',
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    );
    expect(setVariable).not.toHaveBeenCalled();
  });

  it('persists explicit blocked hydration summaries with zero counts', async () => {
    getVariable.mockResolvedValue({});

    const hydrationSummary = {
      ok: false,
      status: 'blocked',
      reason: 'missing_spec_directory',
      hydrated_count: 0,
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      implemented_count: 0,
      backlog_count: 0,
      spec_count: 0,
      spec_directory: 'docs/resources',
    };

    await service.setJobOutput('run-1', 'job-1', {
      hydration_summary: hydrationSummary,
    });

    expect(setVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output', {
      hydration_summary: hydrationSummary,
    });
  });

  it('normalizes XML-array {item:[...]} artifacts before persisting', async () => {
    getVariable.mockResolvedValue({});

    await service.setJobOutput('run-1', 'job-1', {
      candidate_records: {
        item: [{ title: 'A', evidenceRefs: { item: ['ref-1', 'ref-2'] } }],
      },
    });

    expect(setVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output', {
      candidate_records: [{ title: 'A', evidenceRefs: ['ref-1', 'ref-2'] }],
    });
  });

  it('emits a best-effort event when an XML-array artifact is normalized', async () => {
    getVariable.mockResolvedValue({});

    await service.setJobOutput('run-1', 'job-1', {
      candidate_records: { item: [{ title: 'A' }] },
    });

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.normalized_xml_artifact',
        workflowRunId: 'run-1',
        jobId: 'job-1',
        toolName: 'set_job_output',
      }),
    );
  });

  it('emits a durable workflow.agent.output_persisted signal after a successful write', async () => {
    getVariable.mockResolvedValue({ existing: 1 });

    await service.setJobOutput('run-1', 'job-1', { decision: 'reject' });

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: 'workflow.agent.output_persisted',
        outcome: 'success',
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'job-1',
        toolName: 'set_job_output',
      }),
    );
  });

  it('does not emit output_persisted when the write is a no-op', async () => {
    getVariable.mockResolvedValue({ key: 'same' });

    await service.setJobOutput('run-1', 'job-1', { key: 'same' });

    expect(setVariable).not.toHaveBeenCalled();
    expect(emitBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.output_persisted',
      }),
    );
  });

  it('does not emit output_persisted when the run is terminal', async () => {
    assertRunIsActive.mockRejectedValueOnce(
      new ConflictException(
        'Workflow run run-1 has terminal status FAILED; set_job_output is not allowed',
      ),
    );

    await expect(
      service.setJobOutput('run-1', 'job-1', { decision: 'reject' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(emitBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.output_persisted',
      }),
    );
  });

  it('does not emit the normalization event when no artifact is present', async () => {
    getVariable.mockResolvedValue({});

    await service.setJobOutput('run-1', 'job-1', {
      candidate_records: [{ title: 'A' }],
    });

    expect(emitBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.normalized_xml_artifact',
      }),
    );
  });

  it('rejects zero-count hydration summaries that claim success', async () => {
    await expect(
      service.setJobOutput('run-1', 'job-1', {
        hydration_summary: {
          ok: true,
          hydrated_count: 0,
          created_count: 0,
          updated_count: 0,
          implemented_count: 0,
          backlog_count: 0,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.rejected',
        errorCode: 'set_job_output_fabricated_hydration_summary',
      }),
    );
    expect(setVariable).not.toHaveBeenCalled();
  });

  it('rejects a field whose value violates the contract type', async () => {
    // resolver returns the split contract: child_ac_assignments must be
    // array<object{child_ref,ac_ids:array<string>}>
    resolveContract.mockResolvedValue({
      required: ['child_ac_assignments'],
      types: {
        child_ac_assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              child_ref: 'string',
              ac_ids: { type: 'array', items: 'string' },
            },
          },
        },
      },
    });

    await expect(
      service.setJobOutput('run-1', 'split_scope', {
        child_ac_assignments: [''],
      }),
    ).rejects.toThrow(/child_ac_assignments/);

    // and the malformed value is NOT persisted
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('accepts a well-formed value for the same contract', async () => {
    resolveContract.mockResolvedValue({
      required: ['child_ac_assignments'],
      types: {
        child_ac_assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              child_ref: 'string',
              ac_ids: { type: 'array', items: 'string' },
            },
          },
        },
      },
    });

    await service.setJobOutput('run-1', 'split_scope', {
      child_ac_assignments: [{ child_ref: 'p-child-1', ac_ids: ['AC-1'] }],
    });

    expect(stateManager.setVariable).toHaveBeenCalled();
  });

  it('does not enforce missing required fields (partial writes allowed)', async () => {
    resolveContract.mockResolvedValue({
      required: ['a', 'b'],
      types: { a: 'string', b: 'array' },
    });

    // Only 'a' provided; 'b' missing — must NOT throw.
    await service.setJobOutput('run-1', 'job-x', { a: 'hello' });
    expect(stateManager.setVariable).toHaveBeenCalled();
  });

  it('persists normally when the job has no contract', async () => {
    resolveContract.mockResolvedValue(null);
    await service.setJobOutput('run-1', 'job-x', { anything: [''] });
    expect(stateManager.setVariable).toHaveBeenCalled();
  });

  it('emits a rejected ledger signal on a type mismatch', async () => {
    resolveContract.mockResolvedValue({
      required: ['child_ac_assignments'],
      types: {
        child_ac_assignments: { type: 'array', items: { type: 'object' } },
      },
    });

    await expect(
      service.setJobOutput('run-1', 'split_scope', {
        child_ac_assignments: [''],
      }),
    ).rejects.toThrow();

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.rejected',
        errorCode: 'set_job_output_type_mismatch',
      }),
    );
  });

  it('rejects an empty string for a declared field instead of silently persisting it', async () => {
    resolveContract.mockResolvedValue({
      required: ['implementation_plan'],
      types: { implementation_plan: 'string' },
    });

    let caught: unknown;
    try {
      await service.setJobOutput('run-1', 'job-1', {
        implementation_plan: '',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toMatch(
      /implementation_plan/,
    );
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('rejects an empty array for a declared field', async () => {
    resolveContract.mockResolvedValue({
      required: ['items'],
      types: { items: { type: 'array', items: 'string' } },
    });

    await expect(
      service.setJobOutput('run-1', 'job-1', { items: [] }),
    ).rejects.toThrow(/items/);
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('rejects an empty object for a declared field', async () => {
    resolveContract.mockResolvedValue({
      required: ['summary'],
      types: { summary: { type: 'object' } },
    });

    await expect(
      service.setJobOutput('run-1', 'job-1', { summary: {} }),
    ).rejects.toThrow(/summary/);
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('rejects an empty string for a field only declared via required (no types entry)', async () => {
    resolveContract.mockResolvedValue({
      required: ['implementation_plan'],
    });

    await expect(
      service.setJobOutput('run-1', 'job-1', { implementation_plan: '' }),
    ).rejects.toThrow(/implementation_plan/);
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('accepts an empty value for a field that is optional but has a declared type', async () => {
    resolveContract.mockResolvedValue({
      required: ['should_escalate'],
      optional: ['repeated_acs'],
      types: { should_escalate: 'boolean', repeated_acs: 'array' },
    });

    await service.setJobOutput('run-1', 'job-1', {
      should_escalate: false,
      repeated_acs: [],
    });

    expect(setVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output', {
      should_escalate: false,
      repeated_acs: [],
    });
  });

  it('accepts an XML-array single-item artifact normalized into a non-empty array for a declared field', async () => {
    getVariable.mockResolvedValue({});
    resolveContract.mockResolvedValue({
      required: ['candidate_records'],
      types: { candidate_records: { type: 'array' } },
    });

    await service.setJobOutput('run-1', 'job-1', {
      candidate_records: { item: { title: 'A' } },
    });

    expect(setVariable).toHaveBeenCalledWith('run-1', 'jobs.job-1.output', {
      candidate_records: [{ title: 'A' }],
    });
  });
});
