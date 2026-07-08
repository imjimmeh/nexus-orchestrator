import type { IJob } from '@nexus/core';
import type { ISpecialStepHandler } from './step-special-step.types';

export interface SpecialStepForEachParams {
  workflowRunId: string;
  stepId: string;
  step: IJob;
  handler: ISpecialStepHandler;
  rawInputsTemplate: Record<string, unknown>;
  templateVariables?: Record<string, unknown>;
}
