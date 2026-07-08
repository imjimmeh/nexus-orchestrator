import { BadRequestException } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowFailureClassificationService } from '../workflow-repair/workflow-failure-classification.service';
import { WorkflowRunAutonomyDiagnosticsService } from './workflow-run-autonomy-diagnostics.service';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';

describe('WorkflowRunsController failure classification endpoint', () => {
  const workflowPersistence = {
    getWorkflowRun: vi.fn().mockResolvedValue({
      id: 'run-1',
      status: WorkflowStatus.FAILED,
    }),
  };
  const failureClassification = {
    classifyRunFailure: vi.fn().mockResolvedValue({
      class: 'dependency_missing',
      confidence: 0.82,
      reason:
        'Failure evidence indicates a missing dependency, module, or binary.',
      evidenceReferences: [],
      eligibility: 'allow',
      allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    }),
  };
  const autonomyDiagnostics = {
    getRunAutonomyDiagnostics: vi.fn().mockResolvedValue({ items: [] }),
  };

  let controller: WorkflowRunsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new WorkflowRunsController(
      workflowPersistence as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      failureClassification as unknown as WorkflowFailureClassificationService,
      autonomyDiagnostics as unknown as WorkflowRunAutonomyDiagnosticsService,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
      undefined as never,
      undefined as never,
    );
  });

  it('verifies run access before classifying failure and returns the decision', async () => {
    const result = await controller.classifyRunFailure('run-1');

    expect(workflowPersistence.getWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(failureClassification.classifyRunFailure).toHaveBeenCalledWith(
      'run-1',
    );
    expect(result).toEqual({
      success: true,
      data: {
        class: 'dependency_missing',
        confidence: 0.82,
        reason:
          'Failure evidence indicates a missing dependency, module, or binary.',
        evidenceReferences: [],
        eligibility: 'allow',
        allowedRepairActionIds: ['repair.dependency.add_declared_package'],
      },
    });
  });

  it('rejects failure classification for non-failed runs without emitting audit', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValueOnce({
      id: 'run-1',
      status: WorkflowStatus.RUNNING,
    });

    await expect(controller.classifyRunFailure('run-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(failureClassification.classifyRunFailure).not.toHaveBeenCalled();
  });

  it('verifies run access before returning autonomy diagnostics', async () => {
    const result = await controller.findRunAutonomyDiagnostics('run-1');

    expect(workflowPersistence.getWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(autonomyDiagnostics.getRunAutonomyDiagnostics).toHaveBeenCalledWith(
      'run-1',
    );
    expect(result).toEqual({ success: true, data: { items: [] } });
  });
});

describe('listRunExecutions', () => {
  it('lists executions for a run as read models', async () => {
    const rows = [
      {
        id: 'exec-1',
        kind: 'workflow_step',
        state: 'completed',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        harness_id: 'pi',
        agent_profile_name: null,
        provider_source: null,
        workflow_run_id: 'run-1',
        chat_session_id: null,
        context_id: 'job-1',
        created_at: new Date('2026-06-13T00:00:00Z'),
        terminal_at: null,
      },
    ];
    const executionRepository = {
      findByWorkflowRun: vi.fn().mockResolvedValue(rows),
    };

    const controller = new WorkflowRunsController(
      undefined as never, // workflowPersistence
      undefined as never, // streamService
      undefined as never, // workflowRunSteering
      undefined as never, // workflowRunTodoService
      undefined as never, // workflowRunWorkspace
      undefined as never, // workflowGraphReadModel
      undefined as never, // workflowSkillDiagnostics
      undefined as never, // workflowHostMountDiagnostics
      undefined as never, // webAutomationArtifacts
      undefined as never, // failureClassification
      undefined as never, // autonomyDiagnostics
      undefined as never, // budgetDecisionService
      executionRepository as never,
      undefined as never, // retrospectiveTrace
    );

    const result = await controller.listRunExecutions('run-1');

    expect(executionRepository.findByWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('claude-opus-4-8');
  });
});

describe('findRun', () => {
  it('includes latestBudgetDecision in the response data', async () => {
    const mockRun = {
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.COMPLETED,
      state_variables: {},
    };
    const mockDecision = {
      decision: 'warn' as const,
      reasonCode: 'soft_limit_exceeded',
      estimatedCostCents: 150,
      remainingBudgetCents: 50,
    };

    const wfPersistence = {
      getWorkflowRun: vi.fn().mockResolvedValue(mockRun),
    };
    const budgetSvc = {
      getLatestDecision: vi.fn().mockResolvedValue(mockDecision),
    };

    const controller = new WorkflowRunsController(
      wfPersistence as never,
      undefined as never, // streamService
      undefined as never, // workflowRunSteering
      undefined as never, // workflowRunTodoService
      undefined as never, // workflowRunWorkspace
      undefined as never, // workflowGraphReadModel
      undefined as never, // workflowSkillDiagnostics
      undefined as never, // workflowHostMountDiagnostics
      undefined as never, // webAutomationArtifacts
      undefined as never, // failureClassification
      undefined as never, // autonomyDiagnostics
      budgetSvc as unknown as BudgetDecisionService,
      undefined as never, // executionRepository
      undefined as never, // retrospectiveTrace
    );

    const result = await controller.findRun('run-1');

    expect(budgetSvc.getLatestDecision).toHaveBeenCalledWith(
      'workflow_run',
      'run-1',
    );
    expect(result).toEqual({
      success: true,
      data: { ...mockRun, latestBudgetDecision: mockDecision },
    });
  });
});

describe('findRunRetrospectiveTrace', () => {
  it('verifies run access before returning the retrospective trace', async () => {
    const workflowPersistence = {
      getWorkflowRun: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: WorkflowStatus.COMPLETED,
      }),
    };
    const retrospectiveTrace = {
      getTrace: vi.fn().mockResolvedValue({
        workflowRunId: 'run-1',
        findingsTotal: 1,
        outcomes: { routed: 1 },
        findings: [
          {
            index: 0,
            originalRunId: 'original-run-1',
            outcome: 'routed',
            reasonCode: null,
            candidateId: 'candidate-1',
            skillProposalId: null,
          },
        ],
      }),
    };

    const controller = new WorkflowRunsController(
      workflowPersistence as never,
      undefined as never, // streamService
      undefined as never, // workflowRunSteering
      undefined as never, // workflowRunTodoService
      undefined as never, // workflowRunWorkspace
      undefined as never, // workflowGraphReadModel
      undefined as never, // workflowSkillDiagnostics
      undefined as never, // workflowHostMountDiagnostics
      undefined as never, // webAutomationArtifacts
      undefined as never, // failureClassification
      undefined as never, // autonomyDiagnostics
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
      undefined as never, // executionRepository
      retrospectiveTrace as never,
    );

    const result = await controller.findRunRetrospectiveTrace('run-1');

    expect(workflowPersistence.getWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(retrospectiveTrace.getTrace).toHaveBeenCalledWith('run-1');
    expect(result).toEqual({
      success: true,
      data: {
        workflowRunId: 'run-1',
        findingsTotal: 1,
        outcomes: { routed: 1 },
        findings: [
          {
            index: 0,
            originalRunId: 'original-run-1',
            outcome: 'routed',
            reasonCode: null,
            candidateId: 'candidate-1',
            skillProposalId: null,
          },
        ],
      },
    });
  });
});
