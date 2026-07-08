import { Injectable } from '@nestjs/common';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';
import { WebAutomationActionExecutorService } from '../../web-automation/web-automation-action-executor.service';

@Injectable()
export class StepWebAutomationSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'web_automation' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.action + selector/input fields',
  } as const;

  constructor(
    private readonly webAutomationExecutor: WebAutomationActionExecutorService,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const actionResult = await this.webAutomationExecutor.execute({
      workflowRunId,
      stepId,
      inputs: resolvedStepInputs,
    });

    return {
      result: {
        status: 'completed',
        mode: 'web_automation',
        action: actionResult.action,
        success: actionResult.ok,
        artifactId: actionResult.ok
          ? undefined
          : actionResult.failure_artifact_id,
        sessionId: actionResult.session_id,
      },
      output: {
        stepId,
        ...actionResult,
      },
    };
  }
}
