import { Injectable } from '@nestjs/common';
import { IJob, IJobStep } from '@nexus/core';
import { StateMachineService } from '../state-machine.service';
import { StateManagerService } from '../state-manager.service';
import {
  buildFailedOutput,
  buildStepExecutionResult,
  buildTransitionContext,
  cloneState,
  getLoopCount,
  resolveMaxLoops,
  resolveOnErrorTarget,
  resolveStepTarget,
  setNestedValue,
} from './step-execution.helpers';
import {
  areNeedsSatisfied,
  buildStepNeedsContext,
  normalizeWorkflowStepNeeds,
} from '../workflow-needs.utils';

export type {
  StepExecutionResult,
  StepExecutionContext,
} from './step-execution.service.types';
import type {
  StepExecutionContext,
  StepExecutionResult,
} from './step-execution.service.types';

const DEFAULT_MAX_STEP_LOOPS = 5;

@Injectable()
export class StepExecutionService {
  constructor(
    private readonly stateMachine: StateMachineService,
    private readonly stateManager: StateManagerService,
  ) {}

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { workflowRunId, jobId, job, executeStep } = context;
    const steps = Array.isArray(job.steps) ? job.steps : [];

    if (steps.length === 0) {
      throw new Error(`Job ${jobId} has no steps to execute`);
    }

    const executionState = await this.initializeExecutionState(
      workflowRunId,
      jobId,
      steps,
      context.stateVariables,
    );

    while (executionState.currentStepId) {
      const result = await this.runSingleStepIteration(
        workflowRunId,
        jobId,
        job,
        steps,
        executeStep,
        executionState,
      );
      if (result) {
        return result;
      }
    }

    return buildStepExecutionResult(
      'completed',
      executionState.finalStepId,
      executionState.outputs,
    );
  }

  private async initializeExecutionState(
    workflowRunId: string,
    jobId: string,
    steps: IJobStep[],
    stateVariables: Record<string, unknown>,
  ): Promise<{
    localState: Record<string, unknown>;
    stepById: Map<string, IJobStep>;
    outputs: Record<string, Record<string, unknown>>;
    currentStepId: string;
    finalStepId?: string;
  }> {
    const localState = cloneState(stateVariables);
    const stepById = new Map<string, IJobStep>();
    for (const step of steps) {
      stepById.set(step.id, step);
      await this.setStepField(
        workflowRunId,
        jobId,
        localState,
        step.id,
        'status',
        'pending',
      );
      await this.setStepField(
        workflowRunId,
        jobId,
        localState,
        step.id,
        'loop_count',
        0,
      );
    }

    return {
      localState,
      stepById,
      outputs: {},
      currentStepId: steps[0].id,
    };
  }

  private async runSingleStepIteration(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    steps: IJobStep[],
    executeStep: StepExecutionContext['executeStep'],
    executionState: {
      localState: Record<string, unknown>;
      stepById: Map<string, IJobStep>;
      outputs: Record<string, Record<string, unknown>>;
      currentStepId: string;
      finalStepId?: string;
    },
  ): Promise<StepExecutionResult | null> {
    const currentStep = this.resolveCurrentStep(
      executionState.stepById,
      executionState.currentStepId,
      jobId,
    );
    executionState.finalStepId = currentStep.id;

    const skipResult = await this.skipStepWhenBlocked(
      workflowRunId,
      jobId,
      steps,
      currentStep,
      executionState,
    );
    if (skipResult) {
      return skipResult;
    }

    await this.ensureStepLoopLimit(
      workflowRunId,
      jobId,
      job,
      currentStep,
      executionState.localState,
    );

    const executed = await this.executeStepWithFailureHandling(
      workflowRunId,
      jobId,
      steps,
      currentStep,
      executeStep,
      executionState,
    );
    if (executed.result) {
      return executed.result;
    }

    const transitionResult = await this.handleStepTransition(
      workflowRunId,
      jobId,
      steps,
      currentStep,
      executed.output,
      executionState,
    );
    if (transitionResult) {
      return transitionResult;
    }

    return null;
  }

  private async skipStepWhenBlocked(
    workflowRunId: string,
    jobId: string,
    steps: IJobStep[],
    currentStep: IJobStep,
    executionState: {
      localState: Record<string, unknown>;
      outputs: Record<string, Record<string, unknown>>;
      currentStepId: string;
      finalStepId?: string;
    },
  ): Promise<StepExecutionResult | null> {
    const skipReason = this.resolveStepSkipReason(
      currentStep,
      jobId,
      executionState.localState,
    );
    if (!skipReason) {
      return null;
    }

    const skippedOutput = { skipped: true, reason: skipReason };
    executionState.outputs[currentStep.id] = skippedOutput;
    await this.setStepField(
      workflowRunId,
      jobId,
      executionState.localState,
      currentStep.id,
      'output',
      skippedOutput,
    );
    await this.setStepField(
      workflowRunId,
      jobId,
      executionState.localState,
      currentStep.id,
      'status',
      'skipped',
    );

    const resolvedTarget = resolveStepTarget(null, currentStep, steps);
    const result = this.resolveTerminalTargetResult(
      resolvedTarget,
      executionState.finalStepId,
      executionState.outputs,
    );
    if (result) {
      return result;
    }

    executionState.currentStepId = resolvedTarget;
    return null;
  }

  private resolveStepSkipReason(
    currentStep: IJobStep,
    jobId: string,
    localState: Record<string, unknown>,
  ): string | null {
    const needs = normalizeWorkflowStepNeeds(currentStep);
    if (needs.length > 0) {
      const needsContext = buildStepNeedsContext(localState, jobId);
      if (!areNeedsSatisfied({ needs, context: needsContext })) {
        return 'needs_not_satisfied';
      }
    }

    if (currentStep.if) {
      const needsContext = buildStepNeedsContext(localState, jobId);
      const rendered = this.stateManager.substituteTemplate(currentStep.if, {
        ...localState,
        needs: needsContext,
      });
      if (rendered !== 'true') {
        return 'condition_false';
      }
    }

    return null;
  }

  private resolveCurrentStep(
    stepById: Map<string, IJobStep>,
    currentStepId: string,
    jobId: string,
  ): IJobStep {
    const currentStep = stepById.get(currentStepId);
    if (!currentStep) {
      throw new Error(
        `Step transition target '${currentStepId}' was not found in job '${jobId}'`,
      );
    }

    return currentStep;
  }

  private async ensureStepLoopLimit(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    step: IJobStep,
    localState: Record<string, unknown>,
  ): Promise<void> {
    const currentLoopCount = getLoopCount(localState, jobId, step.id);
    const maxLoops = resolveMaxLoops(job, step, DEFAULT_MAX_STEP_LOOPS);
    if (currentLoopCount >= maxLoops) {
      await this.setStepField(
        workflowRunId,
        jobId,
        localState,
        step.id,
        'status',
        'failed',
      );
      throw new Error(
        `Step '${step.id}' in job '${jobId}' exceeded max loops (${maxLoops})`,
      );
    }

    await this.setStepField(
      workflowRunId,
      jobId,
      localState,
      step.id,
      'loop_count',
      currentLoopCount + 1,
    );
    await this.setStepField(
      workflowRunId,
      jobId,
      localState,
      step.id,
      'status',
      'running',
    );
  }

  private async executeStepWithFailureHandling(
    workflowRunId: string,
    jobId: string,
    steps: IJobStep[],
    currentStep: IJobStep,
    executeStep: StepExecutionContext['executeStep'],
    executionState: {
      localState: Record<string, unknown>;
      outputs: Record<string, Record<string, unknown>>;
      currentStepId: string;
      finalStepId?: string;
    },
  ): Promise<{
    output: Record<string, unknown>;
    result: StepExecutionResult | null;
  }> {
    try {
      const output = await executeStep(currentStep);
      executionState.outputs[currentStep.id] = output;
      await this.setStepField(
        workflowRunId,
        jobId,
        executionState.localState,
        currentStep.id,
        'output',
        output,
      );
      return { output, result: null };
    } catch (error) {
      const failedOutput = buildFailedOutput(error);
      executionState.outputs[currentStep.id] = failedOutput;
      await this.setStepField(
        workflowRunId,
        jobId,
        executionState.localState,
        currentStep.id,
        'output',
        failedOutput,
      );
      await this.setStepField(
        workflowRunId,
        jobId,
        executionState.localState,
        currentStep.id,
        'status',
        'failed',
      );

      const fallbackTarget = resolveOnErrorTarget(currentStep, steps);
      if (!fallbackTarget) {
        throw error;
      }

      const result = this.resolveTerminalTargetResult(
        fallbackTarget,
        executionState.finalStepId,
        executionState.outputs,
      );
      if (result) {
        return { output: failedOutput, result };
      }

      executionState.currentStepId = fallbackTarget;
      return { output: failedOutput, result: null };
    }
  }

  private async handleStepTransition(
    workflowRunId: string,
    jobId: string,
    steps: IJobStep[],
    currentStep: IJobStep,
    stepOutput: Record<string, unknown>,
    executionState: {
      localState: Record<string, unknown>;
      outputs: Record<string, Record<string, unknown>>;
      currentStepId: string;
      finalStepId?: string;
    },
  ): Promise<StepExecutionResult | null> {
    const transitionContext = buildTransitionContext(
      executionState.localState,
      jobId,
    );
    const transitionTarget = this.stateMachine.evaluateTransition(
      currentStep.transitions,
      transitionContext,
    );

    if (stepOutput.ok === false && transitionTarget === null) {
      await this.setStepField(
        workflowRunId,
        jobId,
        executionState.localState,
        currentStep.id,
        'status',
        'failed',
      );

      const fallbackTarget = resolveOnErrorTarget(currentStep, steps);
      if (!fallbackTarget) {
        return buildStepExecutionResult(
          'failed',
          executionState.finalStepId,
          executionState.outputs,
        );
      }

      const fallbackResult = this.resolveTerminalTargetResult(
        fallbackTarget,
        executionState.finalStepId,
        executionState.outputs,
      );
      if (fallbackResult) {
        return fallbackResult;
      }

      executionState.currentStepId = fallbackTarget;
      return null;
    }

    await this.setStepField(
      workflowRunId,
      jobId,
      executionState.localState,
      currentStep.id,
      'status',
      'completed',
    );

    const resolvedTarget = resolveStepTarget(
      transitionTarget,
      currentStep,
      steps,
    );
    const result = this.resolveTerminalTargetResult(
      resolvedTarget,
      executionState.finalStepId,
      executionState.outputs,
    );
    if (result) {
      return result;
    }

    executionState.currentStepId = resolvedTarget;
    return null;
  }

  private resolveTerminalTargetResult(
    target: string,
    finalStepId: string | undefined,
    outputs: Record<string, Record<string, unknown>>,
  ): StepExecutionResult | null {
    if (target === 'done') {
      return buildStepExecutionResult('completed', finalStepId, outputs);
    }

    if (target === 'fail_job') {
      return buildStepExecutionResult('failed', finalStepId, outputs);
    }

    return null;
  }

  private async setStepField(
    workflowRunId: string,
    jobId: string,
    localState: Record<string, unknown>,
    stepId: string,
    field: string,
    value: unknown,
  ): Promise<void> {
    const path = `jobs.${jobId}.steps.${stepId}.${field}`;
    setNestedValue(localState, path.split('.'), value);
    await this.stateManager.setVariable(workflowRunId, path, value);
  }
}
