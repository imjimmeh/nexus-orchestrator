import { runtimeFeedbackSignalSchema } from '@nexus/core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { WorkflowRepairCompletionListener } from './workflow-repair-completion.listener';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  type RepairDelegationCompletedEvent,
} from './repair-delegation.types';

describe('WorkflowRepairCompletionListener', () => {
  const workflowRunId = 'workflow-run-1';
  const workflowId = 'workflow-1';
  const failedJobId = 'failed-job-1';
  const policyActionId = 'repair.config.create_local_placeholder';

  let stateManager: {
    getVariable: Mock<(...args: any[]) => Promise<any>>;
    setVariable: Mock<(...args: any[]) => Promise<any>>;
  };
  let eventLedger: {
    emitBestEffort: Mock<(...args: any[]) => Promise<any>>;
  };
  let failedJobRetryService: {
    retryFailedJobWithMessage: Mock<(...args: any[]) => Promise<any>>;
  };
  let runtimeFeedback: {
    ingest: Mock<(...args: any[]) => Promise<any>>;
  };
  let listener: WorkflowRepairCompletionListener;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stateManager = {
      getVariable: vi.fn().mockResolvedValue({
        attempts: {
          [policyActionId]: 2,
        },
        latest: {
          status: 'dispatched',
          policyActionId,
          executionPath: 'sysadmin_workflow',
          attempt: 2,
          failedJobId,
          recordedAt: '2026-04-29T00:00:00.000Z',
        },
      }),
      setVariable: vi.fn().mockResolvedValue(undefined),
    };
    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    failedJobRetryService = {
      retryFailedJobWithMessage: vi
        .fn()
        .mockResolvedValue({ retried: true, failedJobId }),
    };
    runtimeFeedback = {
      ingest: vi.fn().mockResolvedValue({ promoted: false }),
    };
    listener = new WorkflowRepairCompletionListener(
      stateManager as never,
      eventLedger as never,
      failedJobRetryService as never,
      runtimeFeedback as never,
    );
    warnSpy = vi
      .spyOn(listener['logger'], 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('writes state and audit then retries failed job after successful repair', async () => {
    const event = repairCompletedEvent({ status: 'succeeded' });

    await listener.handleRepairDelegationCompleted(event);

    expect(stateManager.setVariable).toHaveBeenCalledWith(
      workflowRunId,
      REPAIR_DELEGATION_STATE_KEY,
      expect.objectContaining({
        attempts: { [policyActionId]: 2 },
        latest: expect.objectContaining({
          status: 'succeeded',
          policyActionId,
          executionPath: 'sysadmin_workflow',
          attempt: 2,
          failedJobId,
          message: 'Created missing local config placeholder.',
        }),
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        workflowRunId,
        workflowId,
        jobId: failedJobId,
        outcome: 'success',
        severity: 'info',
        errorCode: 'repair_delegation_succeeded',
        errorMessage: 'Created missing local config placeholder.',
        payload: {
          status: 'succeeded',
          policyActionId,
          executionPath: 'sysadmin_workflow',
          attempt: 2,
          failedJobId,
          repairWorkflowRunId: 'repair-run-1',
          doctorRepairAttemptId: undefined,
        },
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: REPAIR_DELEGATION_COMPLETED_EVENT,
        workflowRunId,
        workflowId,
        jobId: failedJobId,
        outcome: 'success',
        severity: 'info',
        errorCode: 'repair_delegation_succeeded',
        errorMessage: 'Created missing local config placeholder.',
        payload: {
          status: 'succeeded',
          policyActionId,
          executionPath: 'sysadmin_workflow',
          attempt: 2,
          failedJobId,
          repairWorkflowRunId: 'repair-run-1',
          doctorRepairAttemptId: undefined,
        },
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith({
      workflowRunId,
      failedJobId,
      retryPrompt:
        'Autonomous repair succeeded for repair.config.create_local_placeholder\n\nCreated missing local config placeholder.',
    });
  });

  it('ingests runtime feedback for successful repair outcomes with a schema-valid stable safe signal', async () => {
    const event = repairCompletedEvent({
      message:
        'Created missing local config placeholder after checking transcript prompt and tool payload.',
    });

    await listener.handleRepairDelegationCompleted(event);

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
    expect(runtimeFeedback.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'repair_outcome',
        source_module: 'workflow-repair',
        affected: expect.objectContaining({
          workflow_run_id: workflowRunId,
          repair_action_id: policyActionId,
        }),
      }),
    );
    expect(eventLedger.emitBestEffort.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeFeedback.ingest.mock.invocationCallOrder[0] ?? 0,
    );

    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(signal.signal_type).toBe('repair_outcome');
    expect(signal.source_module).toBe('workflow-repair');
    expect(signal.scope).toEqual({
      scope_type: 'workflow',
      scope_id: workflowId,
    });
    expect(signal.affected).toEqual(
      expect.objectContaining({
        workflow_id: workflowId,
        workflow_run_id: workflowRunId,
        job_id: failedJobId,
        repair_action_id: policyActionId,
        schema_path: 'sysadmin_workflow',
      }),
    );
    expect(signal.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'repair_outcome',
          id: failedJobId,
          summary: expect.stringContaining('succeeded'),
        }),
      ]),
    );
    expect(signal.examples).toEqual([
      expect.objectContaining({
        redacted: true,
        summary: expect.stringContaining('Created missing local config'),
      }),
    ]);
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.severity).toBe('low');
    expect(signal.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(signal.dedupe_fingerprint).toContain(`policy:${policyActionId}`);
    expect(signal.dedupe_fingerprint).toContain('path:sysadmin_workflow');
    expect(signal.dedupe_fingerprint).toContain(`workflow:${workflowId}`);
    expect(signal.dedupe_fingerprint).toContain(`job:${failedJobId}`);
    expect(signal.dedupe_fingerprint).toContain('status:succeeded');
    expect(signal.dedupe_fingerprint).not.toContain(workflowRunId);
  });

  it('separates repair outcome feedback groups by failed job while aggregating repeated runs for the same failed job', async () => {
    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({
        workflowRunId: 'workflow-run-repeat-1',
        failedJobId: 'stable-failed-job',
      }),
    );
    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({
        workflowRunId: 'workflow-run-repeat-2',
        failedJobId: 'stable-failed-job',
      }),
    );
    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({
        workflowRunId: 'workflow-run-repeat-3',
        failedJobId: 'different-failed-job',
      }),
    );

    const firstSignal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );
    const secondSignal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[1]?.[0],
    );
    const thirdSignal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[2]?.[0],
    );

    expect(firstSignal.affected?.workflow_run_id).toBe('workflow-run-repeat-1');
    expect(secondSignal.affected?.workflow_run_id).toBe(
      'workflow-run-repeat-2',
    );
    expect(firstSignal.dedupe_fingerprint).toBe(
      secondSignal.dedupe_fingerprint,
    );
    expect(firstSignal.dedupe_fingerprint).toContain('job:stable-failed-job');
    expect(firstSignal.dedupe_fingerprint).not.toContain(
      'workflow-run-repeat-1',
    );
    expect(firstSignal.dedupe_fingerprint).not.toContain(
      'workflow-run-repeat-2',
    );
    expect(thirdSignal.dedupe_fingerprint).toContain(
      'job:different-failed-job',
    );
    expect(thirdSignal.dedupe_fingerprint).not.toBe(
      firstSignal.dedupe_fingerprint,
    );
  });

  it('writes state and audit without retry after failed repair', async () => {
    const event = repairCompletedEvent({
      status: 'failed',
      message: 'Repair workflow failed.',
    });

    await listener.handleRepairDelegationCompleted(event);

    expect(stateManager.setVariable).toHaveBeenCalledWith(
      workflowRunId,
      REPAIR_DELEGATION_STATE_KEY,
      expect.objectContaining({
        attempts: { [policyActionId]: 2 },
        latest: expect.objectContaining({
          status: 'failed',
          attempt: 2,
          message: 'Repair workflow failed.',
        }),
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        severity: 'warn',
        errorCode: 'repair_delegation_failed',
        errorMessage: 'Repair workflow failed.',
        payload: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
  });

  it('ingests runtime feedback for failed repair outcomes with failed status in the fingerprint', async () => {
    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({
        status: 'failed',
        message: 'Repair workflow failed.',
      }),
    );

    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
    expect(runtimeFeedback.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'repair_outcome',
        source_module: 'workflow-repair',
        affected: expect.objectContaining({
          workflow_run_id: workflowRunId,
          repair_action_id: policyActionId,
        }),
      }),
    );
    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(signal.signal_type).toBe('repair_outcome');
    expect(signal.severity).toBe('medium');
    expect(signal.dedupe_fingerprint).toContain('status:failed');
    expect(signal.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'repair_outcome',
          summary: expect.stringContaining('failed'),
        }),
      ]),
    );
  });

  it('writes state and audit without retry after successful repair without failed job id', async () => {
    const event = repairCompletedEvent({
      status: 'succeeded',
      failedJobId: undefined,
    });

    await listener.handleRepairDelegationCompleted(event);

    expect(stateManager.setVariable).toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: undefined,
        payload: expect.objectContaining({
          status: 'succeeded',
          failedJobId: undefined,
        }),
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
  });

  it('logs and swallows retry service errors without recording terminal success', async () => {
    const retryError = new Error('queue unavailable');
    failedJobRetryService.retryFailedJobWithMessage.mockRejectedValue(
      retryError,
    );

    await expect(
      listener.handleRepairDelegationCompleted(repairCompletedEvent()),
    ).resolves.toBeUndefined();

    expect(stateManager.setVariable).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      `Failed to process repair delegation completion for run ${workflowRunId}: queue unavailable`,
      retryError.stack,
    );
  });

  it('preserves completion handling and retry behavior when runtime feedback ingestion fails', async () => {
    runtimeFeedback.ingest.mockRejectedValueOnce(new Error('feedback down'));

    await expect(
      listener.handleRepairDelegationCompleted(repairCompletedEvent()),
    ).resolves.toBeUndefined();

    expect(stateManager.setVariable).toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalled();
    expect(runtimeFeedback.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'repair_outcome',
        source_module: 'workflow-repair',
        affected: expect.objectContaining({
          workflow_run_id: workflowRunId,
          repair_action_id: policyActionId,
        }),
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledTimes(1);
  });

  it('leaves successful completion retryable when retry queueing fails so replay retries', async () => {
    let currentState = {
      attempts: { [policyActionId]: 2 },
      latest: {
        status: 'dispatched',
        policyActionId,
        executionPath: 'sysadmin_workflow',
        attempt: 2,
        failedJobId,
        recordedAt: '2026-04-29T00:00:00.000Z',
      },
    };
    stateManager.getVariable.mockImplementation(() =>
      Promise.resolve(currentState),
    );
    stateManager.setVariable.mockImplementation((_runId, _key, nextState) => {
      currentState = nextState;
      return Promise.resolve();
    });
    failedJobRetryService.retryFailedJobWithMessage
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce({ retried: true, failedJobId });

    const event = repairCompletedEvent();
    await listener.handleRepairDelegationCompleted(event);
    expect(currentState.latest.status).toBe('dispatched');

    await listener.handleRepairDelegationCompleted(event);

    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledTimes(2);
    expect(currentState.latest.status).toBe('succeeded');
  });

  it('ignores stale lower-attempt completions without corrupting latest state or retrying', async () => {
    stateManager.getVariable.mockResolvedValue({
      attempts: { [policyActionId]: 3 },
      latest: {
        status: 'dispatched',
        policyActionId,
        executionPath: 'sysadmin_workflow',
        attempt: 3,
        failedJobId,
        recordedAt: '2026-04-29T00:00:00.000Z',
      },
    });

    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({ attempt: 2, status: 'succeeded' }),
    );

    expect(stateManager.setVariable).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
  });

  it('ignores duplicate successful completion for the same action and attempt', async () => {
    stateManager.getVariable.mockResolvedValue({
      attempts: { [policyActionId]: 2 },
      latest: {
        status: 'succeeded',
        policyActionId,
        executionPath: 'sysadmin_workflow',
        attempt: 2,
        failedJobId,
        message: 'Created missing local config placeholder.',
        recordedAt: '2026-04-29T00:00:00.000Z',
      },
    });

    await listener.handleRepairDelegationCompleted(repairCompletedEvent());

    expect(stateManager.setVariable).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
    expect(runtimeFeedback.ingest).not.toHaveBeenCalled();
  });

  it('does not overwrite latest or retry when a different repair action is currently dispatched', async () => {
    const currentLatest = {
      status: 'dispatched',
      policyActionId: 'repair.dependency.add_declared_package',
      executionPath: 'sysadmin_workflow',
      attempt: 1,
      failedJobId: 'newer-failed-job',
      recordedAt: '2026-04-29T00:00:00.000Z',
    };
    stateManager.getVariable.mockResolvedValue({
      attempts: {
        [policyActionId]: 2,
        'repair.dependency.add_declared_package': 1,
      },
      latest: currentLatest,
    });

    await listener.handleRepairDelegationCompleted(repairCompletedEvent());

    expect(stateManager.setVariable).not.toHaveBeenCalled();
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
  });

  it('serializes concurrent duplicate success completions so only one retry happens', async () => {
    let currentState = {
      attempts: { [policyActionId]: 2 },
      latest: {
        status: 'dispatched',
        policyActionId,
        executionPath: 'sysadmin_workflow',
        attempt: 2,
        failedJobId,
        recordedAt: '2026-04-29T00:00:00.000Z',
      },
    };
    stateManager.getVariable.mockImplementation(() =>
      Promise.resolve(currentState),
    );
    stateManager.setVariable.mockImplementation((_runId, _key, nextState) => {
      currentState = nextState;
      return Promise.resolve();
    });

    await Promise.all([
      listener.handleRepairDelegationCompleted(repairCompletedEvent()),
      listener.handleRepairDelegationCompleted(repairCompletedEvent()),
    ]);

    expect(stateManager.setVariable).toHaveBeenCalledTimes(1);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(2);
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledTimes(1);
    expect(runtimeFeedback.ingest).toHaveBeenCalledTimes(1);
  });

  it('uses sanitized completion messages for state, audits, retry prompt, and feedback', async () => {
    const rawMessage = `Created config with bare sk-live-bare-token pk-live-bare-token rk-live-bare-token, "token":"abc123.with.dots;tail", "apiKey": "def.456.jwt.suffix", password is hunter two. authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature, credential: |
line-one
line-two
${'x'.repeat(700)}`;

    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({ message: rawMessage }),
    );

    const savedState = stateManager.setVariable.mock.calls[0]?.[2];
    const genericAuditEvent = eventLedger.emitBestEffort.mock.calls[0]?.[0];
    const lifecycleAuditEvent = eventLedger.emitBestEffort.mock.calls[1]?.[0];
    const retryRequest =
      failedJobRetryService.retryFailedJobWithMessage.mock.calls[0]?.[0];
    const feedbackFields = JSON.stringify(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(savedState.latest.message).toContain('"token":"[REDACTED]"');
    expect(savedState.latest.message).toContain('"apiKey": "[REDACTED]"');
    expect(savedState.latest.message).toContain('password is [REDACTED]');
    expect(savedState.latest.message).toContain('authorization: [REDACTED]');
    expect(savedState.latest.message).toContain('credential: [REDACTED]');
    expect(savedState.latest.message).not.toContain('abc123');
    expect(savedState.latest.message).not.toContain('hunter two');
    expect(savedState.latest.message).not.toContain('def 456');
    expect(savedState.latest.message).not.toContain('def.456.jwt.suffix');
    expect(savedState.latest.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(savedState.latest.message).not.toContain('payload.signature');
    expect(savedState.latest.message).not.toContain('sk-live-bare-token');
    expect(savedState.latest.message).not.toContain('pk-live-bare-token');
    expect(savedState.latest.message).not.toContain('rk-live-bare-token');
    expect(savedState.latest.message).not.toContain('line-one');
    expect(savedState.latest.message.length).toBeLessThanOrEqual(500);
    expect(genericAuditEvent.errorMessage).toBe(savedState.latest.message);
    expect(lifecycleAuditEvent.errorMessage).toBe(savedState.latest.message);
    expect(retryRequest.retryPrompt).toContain(savedState.latest.message);
    expect(retryRequest.retryPrompt).not.toContain('abc123');
    expect(retryRequest.retryPrompt).not.toContain('hunter two');
    expect(retryRequest.retryPrompt).not.toContain('def.456.jwt.suffix');
    expect(retryRequest.retryPrompt).not.toContain('payload.signature');
    expect(retryRequest.retryPrompt).not.toContain('sk-live-bare-token');
    expect(retryRequest.retryPrompt).not.toContain('pk-live-bare-token');
    expect(retryRequest.retryPrompt).not.toContain('rk-live-bare-token');
    expect(retryRequest.retryPrompt).not.toContain('line-one');
    expect(feedbackFields).not.toContain('def.456.jwt.suffix');
    expect(feedbackFields).not.toContain('payload.signature');
    expect(feedbackFields).not.toContain('sk-live-bare-token');
    expect(feedbackFields).not.toContain('pk-live-bare-token');
    expect(feedbackFields).not.toContain('rk-live-bare-token');
  });

  it('fully redacts dotted natural-language secret values', async () => {
    const rawMessage =
      'Repair completed; token is abc.def.ghi. secret is eyJhbGciOiJIUzI1NiJ9.payload.signature, credential is value.with.trailing!';

    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({ message: rawMessage }),
    );

    const savedState = stateManager.setVariable.mock.calls[0]?.[2];
    const persistedFields = JSON.stringify({
      state: savedState,
      audits: eventLedger.emitBestEffort.mock.calls,
      retry: failedJobRetryService.retryFailedJobWithMessage.mock.calls,
      feedback: runtimeFeedback.ingest.mock.calls,
    });

    expect(savedState.latest.message).toContain('token is [REDACTED].');
    expect(savedState.latest.message).toContain('secret is [REDACTED],');
    expect(savedState.latest.message).toContain('credential is [REDACTED]!');
    expect(persistedFields).not.toContain('abc.def.ghi');
    expect(persistedFields).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(persistedFields).not.toContain('payload.signature');
    expect(persistedFields).not.toContain('value.with.trailing');
  });

  it('uses sanitized completion messages in feedback and does not persist raw transcript prompt tool payload or secrets', async () => {
    const secretValue = 'sk-secret-value-that-must-not-leak';
    const dottedBearer = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const rawMessage = `Transcript prompt included ${secretValue}. Tool payload body: {"apiKey":"${secretValue}.suffix","stdout":"raw tool output"}. authorization: Bearer ${dottedBearer}`;

    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({ message: rawMessage }),
    );

    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );
    const persistedFeedbackFields = JSON.stringify(signal);

    expect(persistedFeedbackFields).toContain('[REDACTED]');
    expect(persistedFeedbackFields).not.toContain('sk-');
    expect(persistedFeedbackFields).not.toContain(secretValue);
    expect(persistedFeedbackFields).not.toContain(dottedBearer);
    expect(persistedFeedbackFields).not.toContain('payload.signature');
    expect(persistedFeedbackFields).not.toContain('raw output');
    expect(persistedFeedbackFields).not.toContain('raw tool output');
    expect(persistedFeedbackFields).not.toContain('Tool payload body');
    expect(persistedFeedbackFields.toLowerCase()).not.toContain(
      'tool payload body',
    );
    expect(signal.examples).toEqual([
      expect.objectContaining({ redacted: true }),
    ]);
  });

  it('keeps prefixed feedback examples schema-valid when the sanitized message reaches the maximum length', async () => {
    await listener.handleRepairDelegationCompleted(
      repairCompletedEvent({ message: 'x'.repeat(700) }),
    );

    const signal = runtimeFeedbackSignalSchema.parse(
      runtimeFeedback.ingest.mock.calls[0]?.[0],
    );

    expect(signal.examples[0]?.summary).toContain(
      'Sanitized completion message:',
    );
    expect(signal.examples[0]?.summary.length).toBeLessThanOrEqual(500);
  });

  function repairCompletedEvent(
    overrides: Partial<RepairDelegationCompletedEvent> = {},
  ): RepairDelegationCompletedEvent {
    return {
      workflowRunId,
      workflowId,
      failedJobId,
      policyActionId,
      executionPath: 'sysadmin_workflow',
      attempt: 2,
      status: 'succeeded',
      message: 'Created missing local config placeholder.',
      repairWorkflowRunId: 'repair-run-1',
      ...overrides,
    };
  }
});
