import { NotFoundException } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEventRepository } from '../database/repositories/workflow-event.repository';
import type { IWorkflowDefinitionRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowParserService } from '../workflow-parser.service';
import { WorkflowGraphReadModelService } from './workflow-graph-read-model.service';

describe('WorkflowGraphReadModelService', () => {
  const workflowRepo = {
    findById: vi.fn(),
    findByIdentifier: vi.fn(),
  };

  const workflowRunRepo = {
    findById: vi.fn(),
  };

  const workflowParser = {
    parseWorkflow: vi.fn(),
  };

  const workflowEventRepo = {
    findByRunId: vi.fn(),
  };

  const service = new WorkflowGraphReadModelService(
    workflowRepo as unknown as IWorkflowDefinitionRepository,
    workflowRunRepo as unknown as IWorkflowRunRepository,
    workflowParser as unknown as WorkflowParserService,
    workflowEventRepo as unknown as WorkflowEventRepository,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workflowRepo.findByIdentifier).mockImplementation((identifier) =>
      vi.mocked(workflowRepo.findById)(identifier),
    );
  });

  it('returns run graph snapshot with normalized job and step statuses', async () => {
    vi.mocked(workflowRunRepo.findById).mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'test_job',
      state_variables: {
        _internal: {
          completed_jobs: { build_job: true },
          queued_jobs: { build_job: true, test_job: true },
        },
        jobs: {
          test_job: {
            steps: {
              execute_tests: {
                status: 'running',
              },
            },
          },
        },
      },
    });

    vi.mocked(workflowRepo.findById).mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow yaml',
    });

    vi.mocked(workflowParser.parseWorkflow).mockReturnValue({
      workflow_id: 'workflow-1',
      name: 'Workflow 1',
      jobs: [
        {
          id: 'build_job',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'compile', prompt: 'Compile source code' }],
        },
        {
          id: 'test_job',
          type: 'execution',
          tier: 'light',
          depends_on: ['build_job'],
          steps: [{ id: 'execute_tests', prompt: 'Run tests' }],
        },
      ],
    });

    vi.mocked(workflowEventRepo.findByRunId).mockResolvedValue([[], 0]);

    const result = await service.getRunGraph('run-1');

    expect(result.workflowRunId).toBe('run-1');
    expect(result.runStatus).toBe(WorkflowStatus.RUNNING);

    const buildNode = result.nodes.find((node) => node.id === 'job:build_job');
    const testNode = result.nodes.find((node) => node.id === 'job:test_job');
    const testStepNode = result.nodes.find(
      (node) => node.id === 'step:test_job:execute_tests',
    );

    expect(buildNode?.status).toBe('succeeded');
    expect(testNode?.status).toBe('running');
    expect(testStepNode?.status).toBe('running');

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'depends_on',
          source: 'job:build_job',
          target: 'job:test_job',
        }),
      ]),
    );
    expect(result.activeNodeIds).toEqual(
      expect.arrayContaining(['job:test_job', 'step:test_job:execute_tests']),
    );
    expect(result.completedNodeIds).toEqual(
      expect.arrayContaining(['job:build_job']),
    );
  });

  it('loads legacy run workflow values by identifier when building a run graph', async () => {
    vi.mocked(workflowRunRepo.findById).mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow_definition_id',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'test_job',
      state_variables: {},
    });

    vi.mocked(workflowRepo.findById).mockRejectedValue(
      new Error('invalid input syntax for type uuid: "workflow_definition_id"'),
    );
    vi.mocked(workflowRepo.findByIdentifier).mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow yaml',
    });

    vi.mocked(workflowParser.parseWorkflow).mockReturnValue({
      workflow_id: 'workflow_definition_id',
      name: 'Workflow Definition',
      jobs: [{ id: 'test_job', type: 'execution', tier: 'light' }],
    });
    vi.mocked(workflowEventRepo.findByRunId).mockResolvedValue([[], 0]);

    const result = await service.getRunGraph('run-1');

    expect(workflowRepo.findByIdentifier).toHaveBeenCalledWith(
      'workflow_definition_id',
      { includeInactive: true },
    );
    expect(result.workflowRunId).toBe('run-1');
  });

  it('returns static workflow graph when no run is supplied', async () => {
    vi.mocked(workflowRepo.findById).mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow yaml',
    });

    vi.mocked(workflowParser.parseWorkflow).mockReturnValue({
      workflow_id: 'workflow-1',
      name: 'Workflow 1',
      jobs: [
        {
          id: 'build_job',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'compile', prompt: 'Compile source code' }],
        },
      ],
    });

    const result = await service.getWorkflowGraph('workflow-1');

    expect(result.workflowRunId).toBeNull();
    expect(result.runStatus).toBeNull();
    expect(result.cursor).toEqual({ latestEventAt: null, totalEvents: 0 });
    expect(result.nodes.every((node) => node.status === 'idle')).toBe(true);
  });

  it('handles workflow jobs without steps when building static graph', async () => {
    vi.mocked(workflowRepo.findById).mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow yaml',
    });

    vi.mocked(workflowParser.parseWorkflow).mockReturnValue({
      workflow_id: 'workflow-1',
      name: 'Workflow 1',
      jobs: [
        {
          id: 'pm_refinement',
          type: 'execution',
          tier: 'heavy',
          steps: [{ id: 'pm_refine', prompt: 'PM refine' }],
        },
        {
          id: 'persist_pm_artifacts',
          type: 'amend_entity',
          tier: 'light',
          depends_on: ['pm_refinement'],
          inputs: { entity_type: 'resource', action: 'patch_metadata' },
        },
      ],
    });

    const result = await service.getWorkflowGraph('workflow-1');

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job:persist_pm_artifacts',
          kind: 'job',
          metadata: expect.objectContaining({
            stepCount: 0,
          }),
        }),
      ]),
    );

    expect(
      result.nodes.some((node) =>
        node.id.startsWith('step:persist_pm_artifacts:'),
      ),
    ).toBe(false);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'depends_on',
          source: 'job:pm_refinement',
          target: 'job:persist_pm_artifacts',
        }),
      ]),
    );
  });

  it('throws when run cannot be found', async () => {
    vi.mocked(workflowRunRepo.findById).mockResolvedValue(null);

    await expect(service.getRunGraph('run-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
