import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { normalizeOptionalString } from '@nexus/core';
import type { IWorkflow } from '@nexus/core';
import type {
  WorkflowLaunchContext,
  WorkflowLaunchContract,
  WorkflowLaunchDescriptor,
  WorkflowLaunchEligibility,
  WorkflowLaunchValidationIssue,
} from '@nexus/core';

export function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function resolveActorId(req: Request): string | null {
  const user = (
    req as Request & {
      user?: {
        id?: string;
        sub?: string;
      };
    }
  ).user;

  return (
    normalizeOptionalString(user?.id) ?? normalizeOptionalString(user?.sub)
  );
}

export function buildLaunchValidationException(
  issues: WorkflowLaunchValidationIssue[],
): BadRequestException {
  return new BadRequestException({
    code: 'WORKFLOW_LAUNCH_VALIDATION_FAILED',
    message: 'Workflow launch payload validation failed.',
    issues,
  });
}

export function buildWorkflowLaunchDescriptor(params: {
  workflow: IWorkflow;
  context: WorkflowLaunchContext;
  parseWorkflow: (yamlDefinition: string) => {
    workflow_id: string;
    name: string;
    description?: string;
  };
  buildContract: (definition: unknown) => WorkflowLaunchContract;
  evaluateEligibility: (
    contract: WorkflowLaunchContract,
    context: WorkflowLaunchContext,
  ) => WorkflowLaunchEligibility;
}): WorkflowLaunchDescriptor | null {
  try {
    const definition = params.parseWorkflow(params.workflow.yaml_definition);
    const contract = params.buildContract(definition);
    const eligibility = params.evaluateEligibility(contract, params.context);

    return {
      workflowRowId: params.workflow.id,
      workflowDefinitionId: definition.workflow_id,
      workflowName: definition.name,
      isActive: params.workflow.is_active,
      description: definition.description,
      contract,
      eligibility,
    };
  } catch {
    return null;
  }
}
