import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WorkflowSkillBinding } from './workflow-skill-binding.entity';
import type {
  InsertWorkflowSkillBindingInput,
  WorkflowSkillBindingKey,
} from './workflow-skill-binding.repository.types';

/**
 * Persistence surface for `workflow_skill_bindings`. `findExisting` mirrors
 * the migration's `(workflow_name, COALESCE(step_id, ''), skill_name)`
 * unique index at the query level: `IsNull()` is used when `stepId` is
 * `null` so a whole-workflow binding is never matched against (or by) a
 * step-scoped one.
 */
@Injectable()
export class WorkflowSkillBindingRepository {
  constructor(
    @InjectRepository(WorkflowSkillBinding)
    private readonly repo: Repository<WorkflowSkillBinding>,
  ) {}

  findExisting(
    key: WorkflowSkillBindingKey,
  ): Promise<WorkflowSkillBinding | null> {
    return this.repo.findOne({
      where: {
        workflow_name: key.workflowName,
        step_id: key.stepId === null ? IsNull() : key.stepId,
        skill_name: key.skillName,
      },
    });
  }

  insert(
    input: InsertWorkflowSkillBindingInput,
  ): Promise<WorkflowSkillBinding> {
    return this.repo.save(this.repo.create(input));
  }

  async deleteExisting(key: WorkflowSkillBindingKey): Promise<void> {
    await this.repo.delete({
      workflow_name: key.workflowName,
      step_id: key.stepId === null ? IsNull() : key.stepId,
      skill_name: key.skillName,
    });
  }

  listForWorkflow(workflowName: string): Promise<WorkflowSkillBinding[]> {
    return this.repo.find({
      where: { workflow_name: workflowName },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * List active (non-rolled-back) bindings for the self-improvement
   * control plane `SkillBindingUsageCard`. A binding is "active" when:
   *   - `provenance IS NOT NULL` — rows written by the
   *     self-improvement pipeline (or any other pipeline-mediated
   *     write) carry provenance; the seed path and direct operator
   *     edits intentionally leave it `null` and are excluded so the
   *     control plane reflects only the bindings the pipeline
   *     believes are in force.
   *   - `provenance->>'rolledBackAt' IS NULL` — a non-null rollback
   *     stamp means the matching improvement proposal was rolled
   *     back after apply; the row is preserved for audit but the
   *     `SkillBindingUsageCard` must not surface it as a live
   *     binding.
   *
   * Default ordering: `created_at DESC` so the freshest pipeline
   * binding wins the top slot. Default limit: 200 (the route's
   * hard cap; matches the
   * `SelfImprovementService.getPromotedLessons` window).
   *
   * Note: the `workflow_skill_bindings` table does NOT have an
   * `archived_at` column (the lifecycle is the rollback-stamp above
   * plus the regular governance flow), so no archived_at filter is
   * applied here.
   */
  listActive(opts: { limit?: number } = {}): Promise<WorkflowSkillBinding[]> {
    const limit = opts.limit ?? 200;
    return this.repo
      .createQueryBuilder('binding')
      .where('binding.provenance IS NOT NULL')
      .andWhere("binding.provenance->>'rolledBackAt' IS NULL")
      .orderBy('binding.created_at', 'DESC')
      .limit(limit)
      .getMany();
  }
}
