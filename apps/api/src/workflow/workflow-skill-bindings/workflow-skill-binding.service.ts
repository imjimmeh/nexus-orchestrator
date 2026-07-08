import { Injectable } from '@nestjs/common';
import { WorkflowSkillBindingRepository } from './workflow-skill-binding.repository';
import type { WorkflowSkillBinding } from './workflow-skill-binding.entity';
import type {
  AddBindingInput,
  RemoveBindingInput,
} from './workflow-skill-binding.service.types';

/**
 * Runtime skill->(workflow | step) binding lifecycle. Bindings live in
 * `workflow_skill_bindings` rather than `workflows.yaml_definition` so a
 * seed reseed never clobbers assignments applied outside of source control
 * (e.g. by the self-improvement pipeline's appliers).
 */
@Injectable()
export class WorkflowSkillBindingService {
  constructor(private readonly repo: WorkflowSkillBindingRepository) {}

  async addBinding(input: AddBindingInput): Promise<WorkflowSkillBinding> {
    const stepId = normalizeStepId(input.stepId);
    const existing = await this.repo.findExisting({
      workflowName: input.workflowName,
      stepId,
      skillName: input.skillName,
    });
    if (existing) return existing;
    return this.repo.insert({
      workflow_name: input.workflowName,
      step_id: stepId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  async removeBinding(input: RemoveBindingInput): Promise<void> {
    await this.repo.deleteExisting({
      workflowName: input.workflowName,
      stepId: normalizeStepId(input.stepId),
      skillName: input.skillName,
    });
  }

  listForWorkflow(workflowName: string): Promise<WorkflowSkillBinding[]> {
    return this.repo.listForWorkflow(workflowName);
  }
}

/**
 * Collapses an empty-string or whitespace-only `stepId` to `null` so it is
 * treated as the workflow-scoped binding rather than bypassing the
 * null-step dedupe special-case (which would otherwise risk a unique
 * constraint violation on `(workflow_name, COALESCE(step_id, ''), skill_name)`).
 */
function normalizeStepId(stepId: string | null | undefined): string | null {
  return stepId?.trim() || null;
}
