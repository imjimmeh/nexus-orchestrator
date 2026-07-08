import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DeepPartial, IsNull, Repository } from 'typeorm';
import { WorkflowLaunchPreset } from '../entities/workflow-launch-preset.entity';

@Injectable()
export class WorkflowLaunchPresetRepository {
  constructor(
    @InjectRepository(WorkflowLaunchPreset)
    private readonly repository: Repository<WorkflowLaunchPreset>,
  ) {}

  async findById(id: string): Promise<WorkflowLaunchPreset | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIdAndWorkflow(
    id: string,
    workflowId: string,
  ): Promise<WorkflowLaunchPreset | null> {
    return this.repository.findOne({
      where: {
        id,
        workflow_id: workflowId,
      },
    });
  }

  async findByWorkflow(
    workflowId: string,
    scopeId?: string,
  ): Promise<WorkflowLaunchPreset[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('preset')
      .where('preset.workflow_id = :workflowId', { workflowId });

    if (scopeId) {
      queryBuilder.andWhere(
        new Brackets((builder) => {
          builder
            .where('preset.scope_id = :scopeId', { scopeId })
            .orWhere('preset.scope_id IS NULL');
        }),
      );
    }

    return queryBuilder
      .orderBy('preset.scope_id', 'DESC')
      .addOrderBy('preset.name', 'ASC')
      .getMany();
  }

  async findByWorkflowProjectAndName(params: {
    workflowId: string;
    scopeId: string | null;
    name: string;
  }): Promise<WorkflowLaunchPreset | null> {
    const scopeId = params.scopeId;

    const where =
      scopeId === null
        ? {
            workflow_id: params.workflowId,
            scopeId: IsNull(),
            name: params.name,
          }
        : {
            workflow_id: params.workflowId,
            scopeId: scopeId,
            name: params.name,
          };

    return this.repository.findOne({
      where,
    });
  }

  async create(
    data: Partial<WorkflowLaunchPreset>,
  ): Promise<WorkflowLaunchPreset> {
    const preset = this.repository.create(
      data as DeepPartial<WorkflowLaunchPreset>,
    );
    return this.repository.save(preset);
  }

  async update(
    id: string,
    data: Partial<WorkflowLaunchPreset>,
  ): Promise<WorkflowLaunchPreset | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const merged = this.repository.merge(existing, data);
    return this.repository.save(merged);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
