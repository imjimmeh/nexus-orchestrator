import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningWorkflowSummary } from '@nexus/core';
import { WorkflowRuntimeRunningWorkflowsService } from './workflow-runtime-running-workflows.service';

function summary(
  overrides: Partial<RunningWorkflowSummary> = {},
): RunningWorkflowSummary {
  return {
    runId: 'run-a',
    workflowName: 'Project Backlog Generation (CEO)',
    status: 'RUNNING',
    ageSeconds: 120,
    ...overrides,
  };
}

describe('WorkflowRuntimeRunningWorkflowsService', () => {
  const persistence = {
    getRunningWorkflowSummariesByScopeId: vi.fn(),
    getWorkflowRun: vi.fn(),
  };
  let service: WorkflowRuntimeRunningWorkflowsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowRuntimeRunningWorkflowsService(persistence as never);
  });

  it('returns scope summaries and a rendered text block for an explicit scope', async () => {
    persistence.getRunningWorkflowSummariesByScopeId.mockResolvedValue([
      summary(),
    ]);

    const result = await service.listRunningWorkflows({
      scope_id: 'scope-1',
      workflow_run_id: 'caller-run',
      limit: 5,
    });

    expect(
      persistence.getRunningWorkflowSummariesByScopeId,
    ).toHaveBeenCalledWith('scope-1', {
      excludeRunId: 'caller-run',
      limit: 5,
    });
    expect(result.scope_id).toBe('scope-1');
    expect(result.count).toBe(1);
    expect(result.running_workflows).toHaveLength(1);
    expect(result.summary).toContain(
      'Workflows already running for this scope (1):',
    );
  });

  it('resolves the scope from the calling run when scope_id is omitted', async () => {
    persistence.getWorkflowRun.mockResolvedValue({
      id: 'caller-run',
      state_variables: { trigger: { scopeId: 'scope-from-run' } },
    });
    persistence.getRunningWorkflowSummariesByScopeId.mockResolvedValue([]);

    const result = await service.listRunningWorkflows({
      workflow_run_id: 'caller-run',
    });

    expect(persistence.getWorkflowRun).toHaveBeenCalledWith('caller-run');
    expect(
      persistence.getRunningWorkflowSummariesByScopeId,
    ).toHaveBeenCalledWith('scope-from-run', {
      excludeRunId: 'caller-run',
      limit: undefined,
    });
    expect(result.scope_id).toBe('scope-from-run');
    expect(result.summary).toBe('');
  });

  it('returns an empty result without querying when no scope can be resolved', async () => {
    const result = await service.listRunningWorkflows({});

    expect(result.scope_id).toBeNull();
    expect(result.count).toBe(0);
    expect(result.running_workflows).toEqual([]);
    expect(
      persistence.getRunningWorkflowSummariesByScopeId,
    ).not.toHaveBeenCalled();
  });
});
