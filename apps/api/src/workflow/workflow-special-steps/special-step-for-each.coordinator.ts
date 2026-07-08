import { Inject, Injectable } from '@nestjs/common';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import { publishTurnEndAndCompleteCore } from '../workflow-step-execution/step-agent-step-executor.completion';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { resolveForEachItems } from './special-step-input-resolver.helpers';
import type { SpecialStepForEachParams } from './special-step-for-each.coordinator.types';
import type { SpecialStepExecutionResult } from './step-special-step.types';

/**
 * Dispatches a `for_each` special step: resolves the iteration list, runs the
 * handler once per item with per-iteration template variables (`item`,
 * `item_index`), aggregates per-item outputs/errors, and publishes the
 * `turn_end` event plus `handleJobComplete` aggregate. Kept handler-agnostic
 * so any `ISpecialStepHandler` registered in the registry can be driven.
 */
@Injectable()
export class SpecialStepForEachCoordinator {
  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly eventPublisher: StepEventPublisherService,
    private readonly support: StepSupportService,
  ) {}

  async execute(
    params: SpecialStepForEachParams,
  ): Promise<SpecialStepExecutionResult> {
    const templateVariables = params.templateVariables ?? {};
    const items = resolveForEachItems(
      params.step,
      templateVariables,
      this.support,
    );
    const outputs: Record<string, unknown>[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    for (let index = 0; index < items.length; index += 1) {
      const iterationVariables = {
        ...templateVariables,
        item: items[index],
        item_index: index,
      };

      const iterationInputs = this.support.resolveJobInputs(
        params.rawInputsTemplate,
        iterationVariables,
      );

      try {
        const execution = await params.handler.execute({
          workflowRunId: params.workflowRunId,
          stepId: params.stepId,
          step: params.step,
          resolvedStepInputs: iterationInputs,
        });
        outputs.push(execution.output);
      } catch (error) {
        if (params.step.continue_on_error === true) {
          errors.push({
            index,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        throw error;
      }
    }

    const aggregateOutput: Record<string, unknown> = {
      ok: errors.length === 0,
      results: outputs,
      errors,
      iterations: items.length,
    };
    await publishTurnEndAndCompleteCore({
      workflowEngine: this.workflowEngine,
      eventPublisher: this.eventPublisher,
      workflowRunId: params.workflowRunId,
      jobId: params.stepId,
      output: aggregateOutput,
      payloadField: 'stepId',
    });

    return {
      status: 'completed',
      mode: 'for_each',
      iterations: items.length,
      errorCount: errors.length,
    };
  }
}
