import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  UserQuestionAwait,
  PostedQuestion,
  SubmittedAnswer,
  UserQuestionDeliveryChannel,
} from '../entities/user-question-await.entity';

@Injectable()
export class UserQuestionAwaitRepository {
  constructor(
    @InjectRepository(UserQuestionAwait)
    private readonly repo: Repository<UserQuestionAwait>,
  ) {}

  async createPosed(input: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    questions: PostedQuestion[];
  }): Promise<UserQuestionAwait> {
    await this.repo.update(
      { workflow_run_id: input.workflowRunId, status: 'pending' },
      { status: 'superseded' },
    );
    return this.repo.save({
      workflow_run_id: input.workflowRunId,
      job_id: input.jobId,
      step_id: input.stepId,
      questions: input.questions,
      status: 'pending',
    });
  }

  /** Latest row still owed an answer (pending, or a prior failed delivery). */
  findOpenByRunId(workflowRunId: string): Promise<UserQuestionAwait | null> {
    return this.repo.findOne({
      where: {
        workflow_run_id: workflowRunId,
        status: In(['pending', 'failed_delivery']),
      },
      order: { created_at: 'DESC' },
    });
  }

  async markAnswered(
    id: string,
    answers: SubmittedAnswer[],
    deliveredVia: UserQuestionDeliveryChannel,
  ): Promise<void> {
    await this.repo.update(id, {
      answers,
      status: 'answered',
      delivered_via: deliveredVia,
      answered_at: new Date(),
    });
  }

  async markFailedDelivery(
    id: string,
    answers: SubmittedAnswer[],
  ): Promise<void> {
    await this.repo.update(id, { answers, status: 'failed_delivery' });
  }

  async cancelOpenForRun(workflowRunId: string): Promise<void> {
    await this.repo.update(
      {
        workflow_run_id: workflowRunId,
        status: In(['pending', 'failed_delivery']),
      },
      { status: 'cancelled' },
    );
  }

  async findRunIdsWithOpenQuestions(): Promise<Set<string>> {
    const rows = await this.repo.find({
      select: { workflow_run_id: true },
      where: { status: In(['pending', 'failed_delivery']) },
    });
    return new Set(rows.map((row) => row.workflow_run_id));
  }
}
