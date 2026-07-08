import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowRunTodo } from '../entities/workflow-run-todo.entity';

@Injectable()
export class WorkflowRunTodoRepository {
  constructor(
    @InjectRepository(WorkflowRunTodo)
    private readonly repository: Repository<WorkflowRunTodo>,
  ) {}

  async findById(id: string): Promise<WorkflowRunTodo | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByWorkflowRunId(
    workflowRunId: string,
    includeArchived = false,
  ): Promise<WorkflowRunTodo[]> {
    return this.repository.find({
      where: {
        workflowRunId,
        ...(includeArchived ? {} : { isArchived: false }),
      },
      order: {
        orderIndex: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  async create(data: Partial<WorkflowRunTodo>): Promise<WorkflowRunTodo> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async saveMany(data: Partial<WorkflowRunTodo>[]): Promise<WorkflowRunTodo[]> {
    if (data.length === 0) {
      return [];
    }

    const entities = this.repository.create(data);
    return this.repository.save(entities);
  }

  async update(
    id: string,
    data: Partial<WorkflowRunTodo>,
  ): Promise<WorkflowRunTodo | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.findById(id);
  }

  async archiveMissing(
    workflowRunId: string,
    keepIds: string[],
  ): Promise<void> {
    const qb = this.repository
      .createQueryBuilder()
      .update(WorkflowRunTodo)
      .set({ isArchived: true })
      .where('workflow_run_id = :workflowRunId', { workflowRunId })
      .andWhere('is_archived = false');

    if (keepIds.length > 0) {
      qb.andWhere('id NOT IN (:...keepIds)', { keepIds });
    }

    await qb.execute();
  }
}
