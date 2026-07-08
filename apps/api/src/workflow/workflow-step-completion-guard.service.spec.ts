import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowOutputContractService } from './workflow-output-contract.service';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowRepositoryAggregator } from './workflow-repository-aggregator.service';
import { WorkflowStepCompletionGuardService } from './workflow-step-completion-guard.service';

describe('WorkflowStepCompletionGuardService', () => {
  let service: WorkflowStepCompletionGuardService;
  let repositories: {
    runs: { findById: ReturnType<typeof vi.fn> };
    workflows: {
      findById: ReturnType<typeof vi.fn>;
      findByIdentifier: ReturnType<typeof vi.fn>;
    };
  };
  let workflowParser: { parseWorkflow: ReturnType<typeof vi.fn> };
  let outputContractService: {
    validateOutputContract: ReturnType<typeof vi.fn>;
    buildDefaultRetryPrompt: ReturnType<typeof vi.fn>;
    buildRetryPrompt: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repositories = {
      runs: {
        findById: vi.fn().mockResolvedValue({
          id: 'run-1',
          workflow_id: 'workflow-1',
        }),
      },
      workflows: {
        findById: vi.fn().mockResolvedValue({
          id: 'workflow-1',
          yaml_definition: 'workflow_id: wf-test',
        }),
        findByIdentifier: vi.fn().mockResolvedValue({
          id: 'workflow-1',
          yaml_definition: 'workflow_id: wf-test',
        }),
      },
    };
    workflowParser = {
      parseWorkflow: vi.fn().mockReturnValue({
        jobs: [
          {
            id: 'job-1',
            output_contract: { required: ['summary', 'artifacts'] },
          },
        ],
      }),
    };
    outputContractService = {
      validateOutputContract: vi.fn().mockResolvedValue({
        valid: false,
        missing: ['artifacts'],
        invalid: [],
      }),
      buildDefaultRetryPrompt: vi
        .fn()
        .mockReturnValue('Call set_job_output with artifacts.'),
      buildRetryPrompt: vi
        .fn()
        .mockReturnValue('Call set_job_output with artifacts (types).'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowStepCompletionGuardService,
        {
          provide: WorkflowRepositoryAggregator,
          useValue: repositories,
        },
        {
          provide: WorkflowParserService,
          useValue: workflowParser,
        },
        {
          provide: WorkflowOutputContractService,
          useValue: outputContractService,
        },
      ],
    }).compile();

    service = module.get(WorkflowStepCompletionGuardService);
  });

  it('denies step completion when required output fields are missing', async () => {
    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(outputContractService.validateOutputContract).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      { required: ['summary', 'artifacts'] },
    );
    expect(result).toEqual({
      allowed: false,
      missing: ['artifacts'],
      typeMismatches: [],
      feedback: 'Call set_job_output with artifacts (types).',
    });
  });

  it('loads legacy run workflow values by identifier before validating output contracts', async () => {
    repositories.runs.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'workflow_definition_id',
    });
    repositories.workflows.findById.mockRejectedValueOnce(
      new Error('invalid input syntax for type uuid: "workflow_definition_id"'),
    );
    repositories.workflows.findByIdentifier.mockResolvedValueOnce({
      id: 'workflow-1',
      yaml_definition: 'workflow_id: workflow_definition_id',
    });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(repositories.workflows.findByIdentifier).toHaveBeenCalledWith(
      'workflow_definition_id',
      { includeInactive: true },
    );
    expect(result).toEqual({
      allowed: false,
      missing: ['artifacts'],
      typeMismatches: [],
      feedback: 'Call set_job_output with artifacts (types).',
    });
  });

  it('allows completion when output contract becomes valid on a recheck', async () => {
    outputContractService.validateOutputContract
      .mockResolvedValueOnce({
        valid: false,
        missing: ['artifacts'],
        invalid: [],
      })
      .mockResolvedValueOnce({ valid: true, missing: [], invalid: [] });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(result).toEqual({ allowed: true, missing: [] });
    expect(outputContractService.validateOutputContract).toHaveBeenCalledTimes(
      2,
    );
  });

  it('denies completion after output contract rechecks still miss fields', async () => {
    outputContractService.validateOutputContract.mockResolvedValue({
      valid: false,
      missing: ['artifacts'],
      invalid: [],
    });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(result).toEqual({
      allowed: false,
      missing: ['artifacts'],
      typeMismatches: [],
      feedback: 'Call set_job_output with artifacts (types).',
    });
    expect(outputContractService.validateOutputContract).toHaveBeenCalledTimes(
      3,
    );
  });

  it('allows completion when the job has no output contract', async () => {
    workflowParser.parseWorkflow.mockReturnValueOnce({
      jobs: [{ id: 'job-1' }],
    });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(outputContractService.validateOutputContract).not.toHaveBeenCalled();
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it('reports type mismatches and includes them in feedback', async () => {
    outputContractService.validateOutputContract.mockResolvedValue({
      valid: false,
      missing: [],
      invalid: [{ field: 'decision', expected: 'string', actual: 'number' }],
      reconciliation: [],
    });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(result).toEqual({
      allowed: false,
      missing: [],
      typeMismatches: [
        { field: 'decision', expected: 'string', actual: 'number' },
      ],
      reconciliationMismatches: [],
      feedback: 'Call set_job_output with artifacts (types).',
    });
    expect(outputContractService.buildRetryPrompt).toHaveBeenCalledWith(
      [],
      [{ field: 'decision', expected: 'string', actual: 'number' }],
      [],
    );
  });

  it('reports reconciliation mismatches and forwards them to the retry prompt', async () => {
    const reconciliation = [
      {
        field: 'items_created',
        tool: 'widget_create',
        reported: 53,
        actual: 0,
      },
    ];
    outputContractService.validateOutputContract.mockResolvedValue({
      valid: false,
      missing: [],
      invalid: [],
      reconciliation,
    });

    const result = await service.validateStepCompletion({
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });

    expect(result).toEqual({
      allowed: false,
      missing: [],
      typeMismatches: [],
      reconciliationMismatches: reconciliation,
      feedback: 'Call set_job_output with artifacts (types).',
    });
    expect(outputContractService.buildRetryPrompt).toHaveBeenCalledWith(
      [],
      [],
      reconciliation,
    );
  });
});
