import { Injectable } from '@nestjs/common';
import type { IWorkflowDefinition } from '@nexus/core';
import { PromptLoaderService } from './prompt-loader.service';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowValidationService } from './workflow-validation.service';

@Injectable()
export class WorkflowDefinitionLoaderService {
  constructor(
    private readonly workflowParser: WorkflowParserService,
    private readonly promptLoader: PromptLoaderService,
    private readonly workflowValidation: WorkflowValidationService,
  ) {}

  async loadExecutableDefinition(
    yamlDefinition: string,
  ): Promise<IWorkflowDefinition> {
    const parsedDefinition = this.workflowParser.parseWorkflow(yamlDefinition);
    const resolvedDefinition =
      this.promptLoader.resolveWorkflowPrompts(parsedDefinition);

    await this.workflowValidation.validateAndThrow(resolvedDefinition);

    return resolvedDefinition;
  }
}
