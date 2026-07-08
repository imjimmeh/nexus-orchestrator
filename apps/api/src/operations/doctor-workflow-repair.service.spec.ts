import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { DoctorWorkflowRepairService } from './doctor-workflow-repair.service';
import type { WorkflowRecoveryCandidatesService } from './workflow-recovery-candidates.service';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowEngineService,
  IWorkflowPersistenceService,
  IWorkflowRunRepository,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { WorkflowFailedJobRetryService } from '../workflow/workflow-failed-job-retry.service';
import type { WorkflowParserService } from '../workflow/workflow-parser.service';

const PRODUCER_JOB_ID = 'produce_output';
const VALIDATION_JOB_ID = 'validate_output';
const VALIDATION_MESSAGE =
  'Downstream validation rejected the produced output: duplicated element across children: E-1';

describe('DoctorWorkflowRepairService.redispatchProducerJobWithFeedback', () => {
  const recoveryCandidates = {} as WorkflowRecoveryCandidatesService;
  const workflowEngine = {} as IWorkflowEngineService;
  const workflowPersistence = {} as IWorkflowPersistenceService;

  const retryService = {
    retryFailedJobWithMessage: vi.fn(),
  };
  const runRepo = {
    findById: vi.fn(),
  };
  const workflowRepo = {
    findByIdentifier: vi.fn(),
  };
  const parser = {
    parseWorkflow: vi.fn(),
  };

  let service: DoctorWorkflowRepairService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DoctorWorkflowRepairService(
      recoveryCandidates,
      workflowEngine,
      workflowPersistence,
      retryService as unknown as WorkflowFailedJobRetryService,
      runRepo as unknown as IWorkflowRunRepository,
      workflowRepo as unknown as IWorkflowDefinitionRepository,
      parser as unknown as WorkflowParserService,
    );
  });

  function arrangeHappyPath(): void {
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'producer_validation_default',
      status: WorkflowStatus.FAILED,
    });
    workflowRepo.findByIdentifier.mockResolvedValue({
      yaml_definition: 'yaml',
    });
    parser.parseWorkflow.mockReturnValue({
      jobs: [
        { id: PRODUCER_JOB_ID, type: 'execution' },
        {
          id: VALIDATION_JOB_ID,
          type: 'mcp_tool_call',
          depends_on: [PRODUCER_JOB_ID],
        },
      ],
    });
  }

  it('redispatches the producer execution job that the failed validation depended on, with feedback', async () => {
    arrangeHappyPath();
    retryService.retryFailedJobWithMessage.mockResolvedValue({
      retried: true,
      failedJobId: PRODUCER_JOB_ID,
    });

    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: false,
      arguments: {
        workflowRunId: 'run-1',
        failedJobId: VALIDATION_JOB_ID,
        validationMessage: VALIDATION_MESSAGE,
      },
    });

    expect(outcome.status).toBe('succeeded');
    expect(retryService.retryFailedJobWithMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        failedJobId: PRODUCER_JOB_ID,
        retryPrompt: expect.stringContaining(VALIDATION_MESSAGE),
      }),
    );
  });

  it('fails when required arguments are missing', async () => {
    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: false,
      arguments: { failedJobId: VALIDATION_JOB_ID },
    });

    expect(outcome.status).toBe('failed');
    expect(retryService.retryFailedJobWithMessage).not.toHaveBeenCalled();
  });

  it('fails when the run cannot be found', async () => {
    runRepo.findById.mockResolvedValue(null);

    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: false,
      arguments: {
        workflowRunId: 'run-1',
        failedJobId: VALIDATION_JOB_ID,
      },
    });

    expect(outcome.status).toBe('failed');
    expect(retryService.retryFailedJobWithMessage).not.toHaveBeenCalled();
  });

  it('fails when no upstream execution producer is found', async () => {
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'producer_validation_default',
      status: WorkflowStatus.FAILED,
    });
    workflowRepo.findByIdentifier.mockResolvedValue({
      yaml_definition: 'yaml',
    });
    parser.parseWorkflow.mockReturnValue({
      jobs: [{ id: VALIDATION_JOB_ID, type: 'mcp_tool_call', depends_on: [] }],
    });

    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: false,
      arguments: {
        workflowRunId: 'run-1',
        failedJobId: VALIDATION_JOB_ID,
      },
    });

    expect(outcome.status).toBe('failed');
    expect(retryService.retryFailedJobWithMessage).not.toHaveBeenCalled();
  });

  it('does not re-dispatch on a dry run but reports success', async () => {
    arrangeHappyPath();

    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: true,
      arguments: {
        workflowRunId: 'run-1',
        failedJobId: VALIDATION_JOB_ID,
        validationMessage: VALIDATION_MESSAGE,
      },
    });

    expect(outcome.status).toBe('succeeded');
    expect(outcome.changes.producerJobId).toBe(PRODUCER_JOB_ID);
    expect(retryService.retryFailedJobWithMessage).not.toHaveBeenCalled();
  });

  it('fails when the retry service rejects the re-dispatch', async () => {
    arrangeHappyPath();
    retryService.retryFailedJobWithMessage.mockResolvedValue(false);

    const outcome = await service.redispatchProducerJobWithFeedback({
      action_id: 'redispatch_producer_job_with_feedback',
      dry_run: false,
      arguments: {
        workflowRunId: 'run-1',
        failedJobId: VALIDATION_JOB_ID,
        validationMessage: VALIDATION_MESSAGE,
      },
    });

    expect(outcome.status).toBe('failed');
  });
});
