import { WorkflowStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowFailureDoctorCompletionListener } from './workflow-failure-doctor-completion.listener';
import type { WorkflowRepairContinuationPolicyService } from './workflow-repair-continuation-policy.service';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn(),
    findById: vi.fn(),
  };
  const runRepo = {
    setStateVariableAtomic: vi.fn(),
  };
  const failedJobRetryService = {
    retryFailedJobWithMessage: vi.fn(),
  };
  const continuationPolicy = {
    resolveFailureDoctorWorkflowIdentifier: vi
      .fn()
      .mockReturnValue('workflow_failure_doctor'),
    resolveFailureDoctorOutputJobId: vi
      .fn()
      .mockReturnValue('diagnose_failure'),
  };

  const listener = new WorkflowFailureDoctorCompletionListener(
    workflowRepo as never,
    runRepo as never,
    failedJobRetryService as never,
    continuationPolicy,
  );

  return {
    listener,
    workflowRepo,
    runRepo,
    failedJobRetryService,
    continuationPolicy,
  };
}

describe('WorkflowFailureDoctorCompletionListener', () => {
  it('retries the original failed job when the doctor marks the failure fixable', async () => {
    const { listener, workflowRepo, runRepo, failedJobRetryService } =
      createListener();

    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'doctor-wf' });
    failedJobRetryService.retryFailedJobWithMessage.mockImplementation(
      async ({ onRetryResolved }) => {
        await onRetryResolved({ failedJobId: 'job-1' });
        return { retried: true, failedJobId: 'job-1' };
      },
    );

    await listener.handleWorkflowCompleted({
      workflowRunId: 'doctor-run',
      workflowId: 'doctor-wf',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {
        trigger: {
          failed_workflow_run_id: 'orig-run',
          failed_job_id: 'job-1',
          failure_reason: 'Missing trigger context',
        },
        jobs: {
          diagnose_failure: {
            output: {
              decision: 'fixable',
              confidence: 0.92,
              rationale: 'The original run lacked required context.',
              remediation_instructions:
                'Re-run after restoring the missing workflow inputs.',
              suggested_input_patch: {
                scope_id: 'project-1',
              },
              evidence: ['project context was null'],
            },
          },
        },
      },
    });

    expect(runRepo.setStateVariableAtomic).toHaveBeenCalledWith(
      'orig-run',
      '_internal.failure_doctor.latest',
      expect.objectContaining({
        doctor_workflow_run_id: 'doctor-run',
        failed_job_id: 'job-1',
        decision: 'fixable',
        rationale: 'The original run lacked required context.',
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'orig-run',
        failedJobId: 'job-1',
        retryPrompt: expect.stringContaining(
          'Re-run after restoring the missing workflow inputs.',
        ),
      }),
    );
  });

  it('records the fallback-resolved failed job id when the trigger does not include one', async () => {
    const { listener, workflowRepo, runRepo, failedJobRetryService } =
      createListener();

    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'doctor-wf' });
    failedJobRetryService.retryFailedJobWithMessage.mockImplementation(
      async ({ onRetryResolved }) => {
        await onRetryResolved({ failedJobId: 'job-from-run' });
        return { retried: true, failedJobId: 'job-from-run' };
      },
    );

    await listener.handleWorkflowCompleted({
      workflowRunId: 'doctor-run',
      workflowId: 'doctor-wf',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {
        trigger: {
          failed_workflow_run_id: 'orig-run',
        },
        jobs: {
          diagnose_failure: {
            output: {
              decision: 'fixable',
              rationale: 'Retry the current failed job.',
            },
          },
        },
      },
    });

    expect(runRepo.setStateVariableAtomic).toHaveBeenCalledWith(
      'orig-run',
      '_internal.failure_doctor.latest',
      expect.objectContaining({
        failed_job_id: 'job-from-run',
      }),
    );
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'orig-run',
        failedJobId: undefined,
        retryPrompt: expect.stringContaining('Retry the current failed job.'),
      }),
    );
  });

  it('does not retry when doctor decision is not_fixable', async () => {
    const { listener, workflowRepo, runRepo, failedJobRetryService } =
      createListener();

    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'doctor-wf' });

    await listener.handleWorkflowCompleted({
      workflowRunId: 'doctor-run',
      workflowId: 'doctor-wf',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {
        trigger: {
          failed_workflow_run_id: 'orig-run',
          failed_job_id: 'job-1',
        },
        jobs: {
          diagnose_failure: {
            output: {
              decision: 'not_fixable',
              confidence: 0.2,
              rationale: 'Requires platform changes.',
            },
          },
        },
      },
    });

    expect(runRepo.setStateVariableAtomic).not.toHaveBeenCalled();
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
  });

  it('does not retry when the original run is no longer failed', async () => {
    const { listener, workflowRepo, runRepo, failedJobRetryService } =
      createListener();

    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'doctor-wf' });
    failedJobRetryService.retryFailedJobWithMessage.mockResolvedValue(false);

    await listener.handleWorkflowCompleted({
      workflowRunId: 'doctor-run',
      workflowId: 'doctor-wf',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {
        trigger: {
          failed_workflow_run_id: 'orig-run',
          failed_job_id: 'job-1',
        },
        jobs: {
          diagnose_failure: {
            output: {
              decision: 'fixable',
              confidence: 0.7,
              rationale: 'Retry might work now.',
            },
          },
        },
      },
    });

    expect(runRepo.setStateVariableAtomic).not.toHaveBeenCalled();
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'orig-run',
        failedJobId: 'job-1',
        retryPrompt: expect.stringContaining('Retry might work now.'),
      }),
    );
  });

  it('uses policy-provided doctor output job id', async () => {
    const {
      listener,
      workflowRepo,
      runRepo,
      failedJobRetryService,
      continuationPolicy,
    } = createListener();

    vi.mocked(
      continuationPolicy.resolveFailureDoctorOutputJobId,
    ).mockReturnValue('custom_diagnosis');
    workflowRepo.findByIdentifier.mockResolvedValue({ id: 'doctor-wf' });
    failedJobRetryService.retryFailedJobWithMessage.mockImplementation(
      async ({ onRetryResolved }) => {
        await onRetryResolved({ failedJobId: 'job-1' });
        return { retried: true, failedJobId: 'job-1' };
      },
    );

    await listener.handleWorkflowCompleted({
      workflowRunId: 'doctor-run',
      workflowId: 'doctor-wf',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {
        trigger: {
          failed_workflow_run_id: 'orig-run',
          failed_job_id: 'job-1',
        },
        jobs: {
          custom_diagnosis: {
            output: {
              decision: 'fixable',
              rationale: 'Custom policy job says retry.',
            },
          },
        },
      },
    });

    expect(runRepo.setStateVariableAtomic).toHaveBeenCalledWith(
      'orig-run',
      '_internal.failure_doctor.latest',
      expect.objectContaining({ rationale: 'Custom policy job says retry.' }),
    );
  });
});
