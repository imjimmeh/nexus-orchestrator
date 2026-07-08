import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentOrchestratorService } from './subagent-orchestrator.service';
import type { SubagentCoordinationService } from './subagent-coordination.service';
import type { SubagentProvisioningService } from './subagent-provisioning.service';

function buildDeps() {
  const provisioning = {
    spawn: vi.fn().mockResolvedValue('exec-1'),
  } as unknown as SubagentProvisioningService;

  const coordination = {
    waitForSubagents: vi.fn().mockResolvedValue({
      status: 'all_completed',
      results: {},
    }),
    checkStatus: vi.fn().mockResolvedValue({
      execution_id: 'exec-1',
      status: 'Completed',
      normalized_status: 'completed',
      terminal: true,
      started_at: new Date('2026-06-25T00:00:00.000Z'),
    }),
    cancelExecution: vi.fn().mockResolvedValue(true),
    cancelActiveForParent: vi
      .fn()
      .mockResolvedValue({ cancelled_execution_ids: [] }),
    handleCompletion: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubagentCoordinationService;

  return { provisioning, coordination };
}

describe('SubagentOrchestratorService', () => {
  let provisioning: SubagentProvisioningService;
  let coordination: SubagentCoordinationService;
  let orchestrator: SubagentOrchestratorService;

  beforeEach(() => {
    const deps = buildDeps();
    provisioning = deps.provisioning;
    coordination = deps.coordination;
    orchestrator = new SubagentOrchestratorService(provisioning, coordination);
  });

  it('forwards spawn to provisioning', async () => {
    const params = {
      agent_profile: 'agent-1',
      task_prompt: 'do work',
      tools: [],
      tier: 'light' as const,
      workflowRunId: 'wf-1',
    };

    const result = await orchestrator.spawn('parent-1', params);

    expect(provisioning.spawn).toHaveBeenCalledTimes(1);
    expect(provisioning.spawn).toHaveBeenCalledWith('parent-1', params);
    expect(result).toBe('exec-1');
  });

  it('forwards waitForSubagents to coordination', async () => {
    const options = {
      executionIds: ['exec-1', 'exec-2'],
      timeoutSeconds: 30,
    };
    const delegated = {
      status: 'all_completed' as const,
      results: { 'exec-1': { status: 'Completed' as const } },
    };
    vi.mocked(coordination.waitForSubagents).mockResolvedValueOnce(delegated);

    const result = await orchestrator.waitForSubagents('parent-1', options);

    expect(coordination.waitForSubagents).toHaveBeenCalledTimes(1);
    expect(coordination.waitForSubagents).toHaveBeenCalledWith(
      'parent-1',
      options,
    );
    expect(result).toBe(delegated);
  });

  it('forwards checkStatus to coordination', async () => {
    const delegated = {
      execution_id: 'exec-1',
      status: 'Running' as const,
      normalized_status: 'running' as const,
      terminal: false,
      started_at: new Date('2026-06-25T00:00:00.000Z'),
    };
    vi.mocked(coordination.checkStatus).mockResolvedValueOnce(delegated);

    const result = await orchestrator.checkStatus('parent-1', 'exec-1', 'wf-1');

    expect(coordination.checkStatus).toHaveBeenCalledTimes(1);
    expect(coordination.checkStatus).toHaveBeenCalledWith(
      'parent-1',
      'exec-1',
      'wf-1',
    );
    expect(result).toBe(delegated);
  });

  it('forwards cancelExecution to coordination', async () => {
    vi.mocked(coordination.cancelExecution).mockResolvedValueOnce(false);

    const result = await orchestrator.cancelExecution('parent-1', 'exec-1', {
      workflowRunId: 'wf-1',
      reason: 'manual_cancel',
    });

    expect(coordination.cancelExecution).toHaveBeenCalledTimes(1);
    expect(coordination.cancelExecution).toHaveBeenCalledWith(
      'parent-1',
      'exec-1',
      { workflowRunId: 'wf-1', reason: 'manual_cancel' },
    );
    expect(result).toBe(false);
  });

  it('forwards cancelActiveForParent to coordination', async () => {
    const delegated = { cancelled_execution_ids: ['exec-1', 'exec-2'] };
    vi.mocked(coordination.cancelActiveForParent).mockResolvedValueOnce(
      delegated,
    );

    const result = await orchestrator.cancelActiveForParent('parent-1', {
      workflowRunId: 'wf-1',
      reason: 'parent_abort',
    });

    expect(coordination.cancelActiveForParent).toHaveBeenCalledTimes(1);
    expect(coordination.cancelActiveForParent).toHaveBeenCalledWith(
      'parent-1',
      { workflowRunId: 'wf-1', reason: 'parent_abort' },
    );
    expect(result).toBe(delegated);
  });

  it('forwards handleCompletion to coordination', async () => {
    const result = { ok: true, value: 42 };

    await orchestrator.handleCompletion('exec-1', result, 'wf-1');

    expect(coordination.handleCompletion).toHaveBeenCalledTimes(1);
    expect(coordination.handleCompletion).toHaveBeenCalledWith(
      'exec-1',
      result,
      'wf-1',
    );
  });
});
