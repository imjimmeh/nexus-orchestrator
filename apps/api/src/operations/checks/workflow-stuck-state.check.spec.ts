import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowRecoveryCandidatesService } from '../workflow-recovery-candidates.service';
import { WorkflowStuckStateCheckService } from './workflow-stuck-state.check';

describe('WorkflowStuckStateCheckService', () => {
  const inspectMock = vi.fn();

  const recoveryCandidates = {
    inspect: inspectMock,
  } as unknown as WorkflowRecoveryCandidatesService;

  let service: WorkflowStuckStateCheckService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowStuckStateCheckService(recoveryCandidates);
  });

  it('returns fail when stale running workflow runs are present', async () => {
    inspectMock.mockResolvedValue({
      running_count: 1,
      pending_count: 0,
      live_queue_run_count: 0,
      stale_running_run_ids: ['run-1'],
      recoverable_pending_run_ids: [],
      expired_owner_lease_execution_ids: [],
    });

    const result = await service.run();

    expect(result.status).toBe('fail');
    expect(result.repair_action_id).toBeUndefined();
  });

  it('returns warn and repair action when only recoverable pending runs exist', async () => {
    inspectMock.mockResolvedValue({
      running_count: 0,
      pending_count: 2,
      live_queue_run_count: 0,
      stale_running_run_ids: [],
      recoverable_pending_run_ids: ['run-2', 'run-3'],
      expired_owner_lease_execution_ids: [],
    });

    const result = await service.run();

    expect(result.status).toBe('warn');
    expect(result.repair_action_id).toBe('requeue_recoverable_workflow_runs');
    expect(result.evidence.summary).toContain(
      'recoverable PENDING workflow run',
    );
  });

  it('warns when expired owner lease executions are present', async () => {
    inspectMock.mockResolvedValue({
      running_count: 0,
      pending_count: 0,
      live_queue_run_count: 0,
      stale_running_run_ids: [],
      recoverable_pending_run_ids: [],
      expired_owner_lease_execution_ids: ['exec-1'],
    });

    const result = await service.run();

    expect(result.status).toBe('warn');
    expect(result.evidence.summary).toContain('expired owner lease');
    expect(result.evidence.details).toMatchObject({
      expired_owner_lease_execution_ids: ['exec-1'],
    });
  });
});
