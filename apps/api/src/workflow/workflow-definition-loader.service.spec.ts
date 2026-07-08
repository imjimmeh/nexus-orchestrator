import { describe, expect, it, vi } from 'vitest';
import type { IWorkflowDefinition } from '@nexus/core';
import { WorkflowDefinitionLoaderService } from './workflow-definition-loader.service';
import { WorkflowParserService } from './workflow-parser.service';
import { PromptLoaderService } from './prompt-loader.service';
import { WorkflowValidationService } from './workflow-validation.service';

describe('WorkflowDefinitionLoaderService', () => {
  it('parses YAML, resolves prompts, validates the resolved definition, and returns it', async () => {
    const yamlDefinition = 'workflow_id: wf\nname: Workflow';
    const parsedDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
    } satisfies IWorkflowDefinition;
    const resolvedDefinition = {
      ...parsedDefinition,
      jobs: [],
    } satisfies IWorkflowDefinition;

    const parser = {
      parseWorkflow: vi.fn(() => parsedDefinition),
    } as unknown as WorkflowParserService;
    const promptLoader = {
      resolveWorkflowPrompts: vi.fn(() => resolvedDefinition),
    } as unknown as PromptLoaderService;
    const workflowValidation = {
      validateAndThrow: vi.fn(async () => undefined),
    } as unknown as WorkflowValidationService;

    const service = new WorkflowDefinitionLoaderService(
      parser,
      promptLoader,
      workflowValidation,
    );

    await expect(
      service.loadExecutableDefinition(yamlDefinition),
    ).resolves.toBe(resolvedDefinition);

    expect(parser.parseWorkflow).toHaveBeenCalledWith(yamlDefinition);
    expect(promptLoader.resolveWorkflowPrompts).toHaveBeenCalledWith(
      parsedDefinition,
    );
    expect(workflowValidation.validateAndThrow).toHaveBeenCalledWith(
      resolvedDefinition,
    );
  });
});
