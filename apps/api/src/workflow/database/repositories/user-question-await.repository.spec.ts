import { describe, expect, it, vi } from 'vitest';
import { In } from 'typeorm';
import { UserQuestionAwaitRepository } from './user-question-await.repository';

function buildRepo() {
  const typeormRepo = {
    update: vi.fn().mockResolvedValue(undefined),
    save: vi
      .fn()
      .mockImplementation((row) => Promise.resolve({ id: 'q-1', ...row })),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
  };
  return {
    repo: new UserQuestionAwaitRepository(typeormRepo),
    typeormRepo,
  };
}

describe('UserQuestionAwaitRepository', () => {
  it('supersedes prior pending rows when a new question is posed', async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.createPosed({
      workflowRunId: 'run-1',
      jobId: 'refine_charter',
      stepId: 'refine',
      questions: [{ question: 'What is the vision?' }],
    });

    expect(typeormRepo.update).toHaveBeenCalledWith(
      { workflow_run_id: 'run-1', status: 'pending' },
      { status: 'superseded' },
    );
    expect(typeormRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'refine_charter', status: 'pending' }),
    );
  });

  it('markAnswered stores answers, channel, and timestamp', async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.markAnswered(
      'q-1',
      [{ questionIndex: 0, selectedOption: null, freeTextAnswer: 'Ship it' }],
      'resume',
    );

    expect(typeormRepo.update).toHaveBeenCalledWith(
      'q-1',
      expect.objectContaining({
        status: 'answered',
        delivered_via: 'resume',
        answered_at: expect.any(Date),
      }),
    );
  });

  it('findOpenByRunId includes failed_delivery rows', async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.findOpenByRunId('run-1');

    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: {
        workflow_run_id: 'run-1',
        status: In(['pending', 'failed_delivery']),
      },
      order: { created_at: 'DESC' },
    });
  });
});
