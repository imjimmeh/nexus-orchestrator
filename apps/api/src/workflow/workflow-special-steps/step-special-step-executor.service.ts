import { Inject, Injectable } from '@nestjs/common';
import { IJob } from '@nexus/core';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { publishTurnEndAndCompleteCore } from '../workflow-step-execution/step-agent-step-executor.completion';
import { SpecialStepForEachCoordinator } from './special-step-for-each.coordinator';
import { resolveSwitchCaseInputs } from './special-step-input-resolver.helpers';
import { SpecialStepExecutionResult } from './step-special-step.types';
import { StepSpecialStepRegistryService } from './step-special-step-registry.service';

@Injectable()
export class StepSpecialStepExecutorService {
  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly eventPublisher: StepEventPublisherService,
    private readonly registry: StepSpecialStepRegistryService,
    private readonly support: StepSupportService,
    private readonly forEachCoordinator: SpecialStepForEachCoordinator,
  ) {}

  async executeSpecialStep(
    workflowRunId: string,
    stepId: string,
    step: IJob,
    resolvedStepInputs: Record<string, unknown>,
    templateVariables?: Record<string, unknown>,
  ): Promise<SpecialStepExecutionResult | null> {
    const stepType = typeof step.type === 'string' ? step.type : null;
    if (!stepType) {
      return null;
    }

    const handler = this.registry.getHandler(stepType);
    if (!handler) {
      return null;
    }

    if (step.for_each) {
      // Do not pre-resolve inputs here — item.* templates must survive until
      // per-iteration resolution inside the coordinator where `item` is in context.
      const rawInputsTemplate = resolveSwitchCaseInputs(
        step,
        templateVariables ?? {},
        this.support,
      );
      return this.forEachCoordinator.execute({
        workflowRunId,
        stepId,
        step,
        handler,
        rawInputsTemplate,
        templateVariables,
      });
    }

    const effectiveInputs = this.resolveEffectiveInputs(
      step,
      resolvedStepInputs,
      templateVariables,
    );

    const execution = await handler.execute({
      workflowRunId,
      stepId,
      step,
      resolvedStepInputs: effectiveInputs,
    });

    await publishTurnEndAndCompleteCore({
      workflowEngine: this.workflowEngine,
      eventPublisher: this.eventPublisher,
      workflowRunId,
      jobId: stepId,
      output: execution.output,
      payloadField: 'stepId',
    });

    return execution.result;
  }

  private resolveEffectiveInputs(
    step: IJob,
    fallbackResolvedInputs: Record<string, unknown>,
    templateVariables?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!templateVariables) {
      return fallbackResolvedInputs;
    }

    const selectedInputsTemplate = resolveSwitchCaseInputs(
      step,
      templateVariables,
      this.support,
    );
    return this.support.resolveJobInputs(
      selectedInputsTemplate,
      templateVariables,
    );
  }
}
