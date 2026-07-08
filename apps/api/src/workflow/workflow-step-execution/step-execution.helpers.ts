import { getNestedValue, IJob, IJobStep } from '@nexus/core';
import type { StepExecutionResult } from './step-execution.service.types';

export function resolveStepTarget(
  transitionTarget: string | null,
  currentStep: IJobStep,
  steps: IJobStep[],
): string {
  if (!transitionTarget) {
    const index = steps.findIndex((step) => step.id === currentStep.id);
    const nextStep = index >= 0 ? steps[index + 1] : undefined;
    return nextStep ? nextStep.id : 'done';
  }

  if (transitionTarget === 'done' || transitionTarget === 'fail_job') {
    return transitionTarget;
  }

  if (transitionTarget.startsWith('goto:')) {
    const gotoStepId = transitionTarget.slice('goto:'.length);
    if (!gotoStepId) {
      throw new Error(
        `Invalid goto transition target '${transitionTarget}' on step '${currentStep.id}'`,
      );
    }

    if (!steps.some((step) => step.id === gotoStepId)) {
      throw new Error(
        `Transition target '${transitionTarget}' on step '${currentStep.id}' references unknown step '${gotoStepId}'`,
      );
    }

    return gotoStepId;
  }

  if (!steps.some((step) => step.id === transitionTarget)) {
    throw new Error(
      `Transition target '${transitionTarget}' on step '${currentStep.id}' references unknown step`,
    );
  }

  return transitionTarget;
}

export function resolveOnErrorTarget(
  step: IJobStep,
  steps: IJobStep[],
): string | null {
  const onError: NonNullable<IJobStep['on_error']> = step.on_error ?? 'fail';
  if (onError === 'fail') {
    return null;
  }

  if (onError === 'continue') {
    const index = steps.findIndex((candidate) => candidate.id === step.id);
    const nextStep = index >= 0 ? steps[index + 1] : undefined;
    return nextStep ? nextStep.id : 'done';
  }

  if (onError.startsWith('goto:')) {
    const stepId = onError.slice('goto:'.length);
    if (!steps.some((candidate) => candidate.id === stepId)) {
      throw new Error(
        `Step '${step.id}' on_error references unknown target '${stepId}'`,
      );
    }
    return stepId;
  }

  return null;
}

export function resolveMaxLoops(
  job: IJob,
  step: IJobStep,
  defaultMaxLoops: number,
): number {
  if (isPositiveInteger(step.max_loops)) {
    return step.max_loops;
  }

  if (isPositiveInteger(job.max_step_loops)) {
    return job.max_step_loops;
  }

  return defaultMaxLoops;
}

export function getLoopCount(
  state: Record<string, unknown>,
  jobId: string,
  stepId: string,
): number {
  const value = getNestedValue(state, [
    'jobs',
    jobId,
    'steps',
    stepId,
    'loop_count',
  ]);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildTransitionContext(
  state: Record<string, unknown>,
  jobId: string,
): Record<string, unknown> {
  const jobs = getNestedValue(state, ['jobs']);
  const currentJobSteps = getNestedValue(state, ['jobs', jobId, 'steps']);

  return {
    ...state,
    ...(jobs && typeof jobs === 'object' ? { jobs } : {}),
    steps:
      currentJobSteps && typeof currentJobSteps === 'object'
        ? currentJobSteps
        : {},
  };
}

export function cloneState(
  stateVariables: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(stateVariables);
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[path.at(-1) as string] = value;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function buildStepExecutionResult(
  status: StepExecutionResult['status'],
  finalStepId: string | undefined,
  outputs: Record<string, Record<string, unknown>>,
): StepExecutionResult {
  return {
    status,
    finalStepId,
    outputs,
  };
}

export function buildFailedOutput(error: unknown): Record<string, unknown> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: errorMessage,
  };
}
