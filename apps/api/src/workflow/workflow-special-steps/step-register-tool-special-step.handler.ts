import { Injectable } from '@nestjs/common';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

@Injectable()
export class StepRegisterToolSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'register_tool' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.name + inputs.schema + inputs.typescript_code',
  } as const;

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async execute({
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const toolName =
      typeof resolvedStepInputs.name === 'string'
        ? resolvedStepInputs.name
        : undefined;
    const toolSchema =
      resolvedStepInputs.schema && typeof resolvedStepInputs.schema === 'object'
        ? (resolvedStepInputs.schema as Record<string, unknown>)
        : undefined;
    const toolCode =
      typeof resolvedStepInputs.typescript_code === 'string'
        ? resolvedStepInputs.typescript_code
        : undefined;
    const tierRestriction =
      typeof resolvedStepInputs.tier_restriction === 'number'
        ? resolvedStepInputs.tier_restriction
        : 1;

    if (!toolName || !toolSchema || !toolCode) {
      throw new Error(
        `Step ${stepId} has type register_tool but missing required tool fields`,
      );
    }

    const createdTool = await this.toolRegistry.upsertTool({
      name: toolName,
      schema: toolSchema,
      typescript_code: toolCode,
      tier_restriction: tierRestriction,
    });

    return {
      result: {
        status: 'completed',
        mode: 'tool_registration',
        toolId: createdTool.id,
      },
      output: {
        ok: true,
        stepId,
        registeredToolId: createdTool.id,
        registeredToolName: createdTool.name,
      },
    };
  }
}
