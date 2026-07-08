import type {
  GitOperationAction,
  TriggerContext,
} from '../step-git-operation-special-step.types';
import type { SpecialStepHandlerResult } from '../step-special-step.types';

export interface GitActionParams {
  workflowRunId: string;
  stepId: string;
  triggerContext: TriggerContext;
  resolvedStepInputs: Record<string, unknown>;
}

export interface GitActionStrategy {
  readonly action: GitOperationAction;
  execute(params: GitActionParams): Promise<SpecialStepHandlerResult>;
}
