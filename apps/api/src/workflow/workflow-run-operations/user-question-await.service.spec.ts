import { describe, expect, it, vi } from 'vitest';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { UserQuestionAwaitService } from './user-question-await.service';

function buildService(overrides?: { run?: Record<string, unknown> | null }) {
  const awaitRepo = {
    createPosed: vi.fn().mockResolvedValue({ id: 'q-1' }),
    cancelOpenForRun: vi.fn().mockResolvedValue(undefined),
  };
  const runRepo = {
    findById: vi.fn().mockResolvedValue(
      overrides?.run !== undefined
        ? overrides.run
        : {
            id: 'run-1',
            current_step_id: 'capture_charter',
            state_variables: {
              _internal: { current_job_id: 'refine_charter' },
            },
          },
    ),
  };
  return {
    service: new UserQuestionAwaitService(
      awaitRepo as never,
      runRepo as unknown as IWorkflowRunRepository,
    ),
    awaitRepo,
    runRepo,
  };
}

describe('UserQuestionAwaitService.recordPosed', () => {
  it('persists the question with the job from _internal.current_job_id, not current_step_id', async () => {
    const { service, awaitRepo } = buildService();

    await service.recordPosed({
      workflowRunId: 'run-1',
      stepId: 'refine',
      questions: [{ question: 'What is the vision?' }],
    });

    expect(awaitRepo.createPosed).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      jobId: 'refine_charter',
      stepId: 'refine',
      questions: [{ question: 'What is the vision?' }],
    });
  });

  it('falls back to current_step_id when _internal.current_job_id is absent', async () => {
    const { service, awaitRepo } = buildService({
      run: {
        id: 'run-1',
        current_step_id: 'only_job',
        state_variables: {},
      },
    });

    await service.recordPosed({
      workflowRunId: 'run-1',
      stepId: 'main',
      questions: [{ question: 'Q?' }],
    });

    expect(awaitRepo.createPosed).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'only_job' }),
    );
  });

  it('does nothing when the run does not exist', async () => {
    const { service, awaitRepo } = buildService({ run: null });

    await service.recordPosed({
      workflowRunId: 'gone',
      stepId: 's',
      questions: [],
    });

    expect(awaitRepo.createPosed).not.toHaveBeenCalled();
  });
});
