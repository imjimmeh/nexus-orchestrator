import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import type { RetrospectiveGateService } from './retrospective-gate.service';
import type { RetrospectiveDrainService } from './retrospective-drain.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';
import type { InterestScore } from './retrospective-gate.types';
import { RetrospectiveEnqueueService } from './retrospective-enqueue.service';

const NEUTRAL_VERDICT: InterestScore = {
  score: 0.2,
  priority: 'normal',
  reasons: ['clean_success'],
  evidenceEventIds: [],
};

describe('RetrospectiveEnqueueService', () => {
  let create: ReturnType<typeof vi.fn>;
  let findByRunId: ReturnType<typeof vi.fn>;
  let findByChatSessionId: ReturnType<typeof vi.fn>;
  let score: ReturnType<typeof vi.fn>;
  let analyzeImmediately: ReturnType<typeof vi.fn>;
  let settingsGet: ReturnType<typeof vi.fn>;
  let getWorkflow: ReturnType<typeof vi.fn>;
  let service: RetrospectiveEnqueueService;

  function buildService(): RetrospectiveEnqueueService {
    return new RetrospectiveEnqueueService(
      {
        create,
        findByRunId,
        findByChatSessionId,
      } as unknown as RetrospectiveQueueRepository,
      { score } as unknown as RetrospectiveGateService,
      { analyzeImmediately } as unknown as RetrospectiveDrainService,
      { get: settingsGet } as unknown as SystemSettingsService,
      { getWorkflow } as unknown as IWorkflowPersistenceService,
    );
  }

  beforeEach(() => {
    create = vi
      .fn()
      .mockImplementation(async (data: Partial<RetrospectiveQueue>) => ({
        id: 'row-1',
        ...data,
      }));
    findByRunId = vi.fn().mockResolvedValue(null);
    findByChatSessionId = vi.fn().mockResolvedValue(null);
    score = vi.fn().mockResolvedValue(NEUTRAL_VERDICT);
    analyzeImmediately = vi.fn().mockResolvedValue({ status: 'analyzed' });
    settingsGet = vi.fn(async (_key: string, _fallback: unknown) => true);
    getWorkflow = vi.fn().mockRejectedValue(new Error('not found'));
    service = buildService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues exactly one queued row for a completed run', async () => {
    await service.enqueueWorkflowRun(makeEvent(), 'completed');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        scope_id: 'scope-1',
        terminal_status: 'completed',
        status: 'queued',
        signals_json: {},
      }),
    );
  });

  it('enqueues exactly one queued row for a failed run', async () => {
    await service.enqueueWorkflowRun(
      makeEvent({ status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        terminal_status: 'failed',
        status: 'queued',
      }),
    );
  });

  it('is idempotent for runs: a second terminal event is a no-op', async () => {
    findByRunId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'row-1',
      workflow_run_id: 'run-1',
      status: 'queued',
    });

    await service.enqueueWorkflowRun(makeEvent(), 'completed');
    await service.enqueueWorkflowRun(
      makeEvent({ status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    'run_retrospective',
    'memory_learning_sweep',
    'project_orchestration_cycle_ceo',
  ])('enqueues nothing for the %s singleton workflow', async (workflowId) => {
    await service.enqueueWorkflowRun(makeEvent({ workflowId }), 'completed');
    await service.enqueueWorkflowRun(
      makeEvent({ workflowId, status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(findByRunId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('skips the analyst workflow when event.workflowId is its persisted UUID, not the logical key', async () => {
    const analystUuid = 'b36d1cdd-1b25-4509-a24c-6b0c12f445a5';
    getWorkflow = vi.fn(async (key: string) =>
      key === 'run_retrospective'
        ? { id: analystUuid }
        : Promise.reject(new Error('not found')),
    );
    service = buildService();

    await service.enqueueWorkflowRun(
      makeEvent({ workflowId: analystUuid, status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(getWorkflow).toHaveBeenCalledWith('run_retrospective');
    expect(create).not.toHaveBeenCalled();
    expect(findByRunId).not.toHaveBeenCalled();
  });

  it('enqueues with scope_id=null and flags signals_json when scope is missing', async () => {
    await service.enqueueWorkflowRun(
      makeEvent({
        status: WorkflowStatus.FAILED,
        stateVariables: { trigger: {} },
      }),
      'failed',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        scope_id: null,
        terminal_status: 'failed',
        signals_json: { scope_missing: true },
      }),
    );
  });

  it('resolves scope_id from the snake_case trigger fallback', async () => {
    await service.enqueueWorkflowRun(
      makeEvent({ stateVariables: { trigger: { scope_id: 'scope-snake' } } }),
      'completed',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scope_id: 'scope-snake' }),
    );
  });

  it('logs and swallows errors thrown by create (fail-soft)', async () => {
    create.mockRejectedValue(new Error('database offline'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.enqueueWorkflowRun(makeEvent(), 'completed'),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('RetrospectiveEnqueueService swallowed'),
      expect.any(String),
    );
  });

  it('logs and swallows errors thrown by findByRunId (fail-soft)', async () => {
    findByRunId.mockRejectedValue(new Error('db unavailable'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.enqueueWorkflowRun(
        makeEvent({ status: WorkflowStatus.FAILED }),
        'failed',
      ),
    ).resolves.toBeUndefined();

    expect(create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('scores the created row via the gate when retrospective is enabled', async () => {
    await service.enqueueWorkflowRun(
      makeEvent({ status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        workflow_run_id: 'run-1',
        terminal_status: 'failed',
      }),
    );
    expect(analyzeImmediately).not.toHaveBeenCalled();
  });

  it('triggers immediate analysis when the gate returns a bypass verdict', async () => {
    score.mockResolvedValue({
      score: 0.95,
      priority: 'bypass',
      reasons: ['anchored_failure'],
      evidenceEventIds: ['ev-1'],
    });

    await service.enqueueWorkflowRun(
      makeEvent({ status: WorkflowStatus.FAILED }),
      'failed',
    );

    expect(score).toHaveBeenCalledTimes(1);
    expect(analyzeImmediately).toHaveBeenCalledTimes(1);
    expect(analyzeImmediately).toHaveBeenCalledWith('run-1');
  });

  it('does not enqueue or score when retrospective is disabled', async () => {
    settingsGet = vi.fn(async (_key: string, fallback: unknown) => fallback);
    service = buildService();

    await service.enqueueWorkflowRun(makeEvent(), 'completed');

    expect(findByRunId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(analyzeImmediately).not.toHaveBeenCalled();
  });

  it('still enqueues when the gate throws (fail-soft scoring)', async () => {
    score.mockRejectedValue(new Error('gate boom'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.enqueueWorkflowRun(
        makeEvent({ status: WorkflowStatus.FAILED }),
        'failed',
      ),
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);
    expect(analyzeImmediately).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('gate/bypass failed'),
      expect.any(String),
    );
  });

  // Chat Session Specifics
  it('enqueues a chat session and scores it', async () => {
    const session = {
      id: 'session-456',
      scopeId: 'scope-xyz',
      status: 'completed',
    };
    await service.enqueueChatSession(session as any);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_session_id: 'session-456',
        source_type: 'chat_session',
        scope_id: 'scope-xyz',
        terminal_status: 'completed',
        status: 'queued',
      }),
    );
  });
});

function makeEvent(
  overrides: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    workflowRunId: 'run-1',
    workflowId: 'standard_feature_flow',
    status: WorkflowStatus.COMPLETED,
    stateVariables: {
      trigger: { scopeId: 'scope-1', agent_profile: 'senior_dev' },
      jobs: { job_a: { ok: true } },
    },
    ...overrides,
  };
}
