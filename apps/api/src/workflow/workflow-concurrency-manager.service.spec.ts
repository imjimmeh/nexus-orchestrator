import { describe, expect, it, vi } from 'vitest';
import { WorkflowConcurrencyManager } from './workflow-concurrency-manager.service';

describe('WorkflowConcurrencyManager', () => {
  const createManager = () => {
    const concurrencyPolicy = {};
    const runRepo = {
      findPendingByScopeAndDedupeKey: vi.fn().mockResolvedValue(null),
      findPendingByScopeAndTrigger: vi.fn().mockResolvedValue(null),
      findLatestByWorkflowAndDedupeKey: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'run-new-1' }),
    };
    const eventLog = { appendBestEffort: vi.fn().mockResolvedValue(undefined) };
    const manager = new WorkflowConcurrencyManager(
      concurrencyPolicy as never,
      runRepo as never,
      eventLog as never,
    );

    return { manager, runRepo, eventLog };
  };

  it('coalesces queued runs with the same trigger dedupe key', async () => {
    const { manager, runRepo, eventLog } = createManager();
    const dedupeKey =
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed';
    const triggerData = {
      scopeId: 'project-1',
      reason: 'workflow_completed',
      source: 'core_lifecycle_stream',
      dedupeKey,
    };
    runRepo.findPendingByScopeAndDedupeKey.mockResolvedValue({
      id: 'queued-run-1',
    });

    const runId = await manager.createQueuedRun(
      'workflow-1',
      triggerData,
      'project-1',
    );

    expect(runId).toBe('queued-run-1');
    expect(runRepo.findPendingByScopeAndTrigger).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith({
      workflowRunId: 'queued-run-1',
      eventType: 'workflow.queue_coalesced',
      payload: {
        workflowId: 'workflow-1',
        triggerData,
        concurrencyScope: 'project-1',
        dedupeKey,
      },
    });
  });

  it('persists launch dedupe key on queued runs', async () => {
    const { manager, runRepo } = createManager();
    const dedupeKey =
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed';
    const triggerData = {
      scopeId: 'project-1',
      reason: 'workflow_completed',
      source: 'core_lifecycle_stream',
      dedupeKey,
    };

    await manager.createQueuedRun('workflow-1', triggerData, 'project-1');

    expect(runRepo.create).toHaveBeenCalledWith({
      workflow_id: 'workflow-1',
      status: 'PENDING',
      state_variables: { trigger: triggerData },
      concurrency_scope: 'project-1',
      launch_dedupe_key: dedupeKey,
    });
  });

  it('returns an existing queued run when a launch dedupe unique conflict occurs', async () => {
    const { manager, runRepo } = createManager();
    const dedupeKey =
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed';
    const triggerData = {
      scopeId: 'project-1',
      reason: 'workflow_completed',
      source: 'core_lifecycle_stream',
      dedupeKey,
    };

    runRepo.create.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint'),
    );
    runRepo.findPendingByScopeAndDedupeKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    runRepo.findLatestByWorkflowAndDedupeKey.mockResolvedValueOnce({
      id: 'queued-run-existing',
    });

    const runId = await manager.createQueuedRun(
      'workflow-1',
      triggerData,
      'project-1',
    );

    expect(runId).toBe('queued-run-existing');
    expect(runRepo.findLatestByWorkflowAndDedupeKey).toHaveBeenCalledWith(
      'workflow-1',
      dedupeKey,
    );
  });

  it('recovers launch dedupe unique conflicts with a workflow-wide run lookup', async () => {
    const { manager, runRepo } = createManager();
    const dedupeKey =
      'project-orchestration-cycle:project-1:core_lifecycle_stream:workflow_completed';
    const triggerData = {
      scopeId: 'project-1',
      reason: 'workflow_completed',
      source: 'core_lifecycle_stream',
      dedupeKey,
    };

    runRepo.create.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint'),
    );
    runRepo.findLatestByWorkflowAndDedupeKey.mockResolvedValueOnce({
      id: 'run-completed-existing',
    });

    const runId = await manager.createQueuedRun(
      'workflow-1',
      triggerData,
      'different-scope',
    );

    expect(runId).toBe('run-completed-existing');
    expect(runRepo.findLatestByWorkflowAndDedupeKey).toHaveBeenCalledWith(
      'workflow-1',
      dedupeKey,
    );
  });
});
