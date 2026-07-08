import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { IWorkflowDefinition } from '@nexus/core';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import { DAGResolverService } from './dag-resolver.service';
import { StepSpecialStepRegistryService } from './workflow-special-steps/step-special-step-registry.service';
import type { SpecialStepHandlerLookup } from './workflow-special-steps/step-special-step.types';
import { DefaultValidationCollector } from './validation/workflow-validation.collector';
import {
  validateJobCollection,
  validateJobTypes,
  validateToolReferences,
} from './validation/workflow-validation.job-validators';
import { validateSkillReferences } from './validation/workflow-validation.skill-rules';
import {
  createValidationContext,
  ValidationResult,
} from './validation/workflow-validation.types';
import {
  validateGraph,
  validateJobStructuralFields,
  validateWorkflowStructure,
} from './validation/workflow-validation.workflow-validators';

@Injectable()
export class WorkflowValidationService {
  constructor(
    private readonly toolRegistryRepo: ToolRegistryRepository,
    private readonly dagResolver: DAGResolverService,
    @Inject(StepSpecialStepRegistryService)
    private readonly specialStepRegistry: SpecialStepHandlerLookup,
    // Optional so pre-existing manual/test instantiations that don't wire a
    // skill catalog keep behaving exactly as before (skill-reference
    // validation simply no-ops — see `validateSkillReferences`).
    private readonly agentSkills?: AgentSkillsService,
  ) {}

  async validateWorkflow(def: IWorkflowDefinition): Promise<ValidationResult> {
    const context = createValidationContext(def);
    const collector = new DefaultValidationCollector();

    validateWorkflowStructure(context, collector);
    validateSkillReferences(context, collector, this.agentSkills);

    if (context.jobs.length === 0) {
      return {
        valid: !collector.hasErrors(),
        errors: collector.toMessages(),
        warnings: collector.toWarningMessages(),
      };
    }

    validateJobCollection(context, collector);
    validateJobStructuralFields(context, collector);
    await validateJobTypes(context, collector, this.specialStepRegistry);
    await validateToolReferences(context, collector, this.toolRegistryRepo);
    validateGraph(context, collector, this.dagResolver);

    return {
      valid: !collector.hasErrors(),
      errors: collector.toMessages(),
      warnings: collector.toWarningMessages(),
    };
  }

  async validateAndThrow(def: IWorkflowDefinition): Promise<void> {
    const { valid, errors } = await this.validateWorkflow(def);
    if (!valid) {
      throw new BadRequestException(
        `Workflow validation failed: ${errors.join(', ')}`,
      );
    }
  }
}
