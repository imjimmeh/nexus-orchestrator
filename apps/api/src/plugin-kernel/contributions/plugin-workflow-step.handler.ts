import type { WorkflowStepContribution } from '@nexus/plugin-sdk';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
  SpecialStepHandlerDescriptor,
} from '../../workflow/workflow-special-steps/step-special-step.types';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';

interface PluginWorkflowStepHandlerTarget {
  readonly pluginId: string;
  readonly version: string;
  readonly contributionId: string;
  readonly globalCapabilityName: string;
  readonly contribution: WorkflowStepContribution;
}

export class PluginWorkflowStepHandler implements ISpecialStepHandler {
  readonly type: string;
  readonly descriptor: SpecialStepHandlerDescriptor;

  constructor(
    private readonly target: PluginWorkflowStepHandlerTarget,
    private readonly runtimeManager: PluginRuntimeManagerService,
  ) {
    this.type = target.globalCapabilityName;
    this.descriptor = {
      type: this.type,
      inputContract: this.toInputContract(
        target.contribution.config.inputContract,
      ),
      owningDomain: 'plugin',
      pluginId: target.pluginId,
      pluginVersion: target.version,
      contributionId: target.contributionId,
      displayName: target.contribution.displayName,
      description: target.contribution.description,
    };
  }

  async execute(
    context: SpecialStepExecutionContext,
  ): Promise<SpecialStepHandlerResult> {
    const runtimeResult = await this.runtimeManager.invokePlugin({
      pluginId: this.target.pluginId,
      version: this.target.version,
      contributionId: this.target.contributionId,
      operation: this.target.contribution.config.operation,
      input: context.resolvedStepInputs,
      actorId: `workflow-step:${context.workflowRunId}:${context.stepId}`,
      timeoutMs: this.target.contribution.config.timeoutMs,
      metadata: {
        workflowRunId: context.workflowRunId,
        stepId: context.stepId,
        stepType: context.step.type,
      },
    });

    if (!runtimeResult.ok) {
      throw new Error(
        `Plugin workflow step failed: ${this.toSafeErrorCode(runtimeResult.error.code)}`,
      );
    }

    return {
      result: {
        status: 'completed',
        source: 'plugin',
        mode: this.type,
        pluginId: this.target.pluginId,
        version: this.target.version,
        contributionId: this.target.contributionId,
      },
      output: {
        ok: true,
        pluginId: this.target.pluginId,
        version: this.target.version,
        contributionId: this.target.contributionId,
        result: runtimeResult.output,
      },
    };
  }

  private toInputContract(
    inputContract: string | Record<string, unknown>,
  ): string {
    return typeof inputContract === 'string'
      ? inputContract
      : JSON.stringify(inputContract);
  }

  private toSafeErrorCode(code: string): string {
    return /^[a-z][a-z0-9_.:_-]*$/.test(code) ? code : 'runtime_error';
  }
}
