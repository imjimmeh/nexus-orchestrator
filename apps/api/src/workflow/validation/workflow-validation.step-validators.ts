import { IJob, IJobStep, isRecord, JobStepType } from '@nexus/core';
import {
  isNonEmptyString,
  isPositiveInteger,
} from './workflow-validation.guards';
import { ValidationCollector } from './workflow-validation.types';
import { RUN_COMMAND_MAX_TIMEOUT_MS } from '../workflow-special-steps/step-run-command-special-step.handler.types';

function formatInvalidValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? '[unserializable]';
  } catch {
    return '[unserializable]';
  }
}

interface StepTypeValidator {
  readonly type: JobStepType;
  validate(step: IJobStep, job: IJob, collector: ValidationCollector): void;
}

class AgentStepValidator implements StepTypeValidator {
  readonly type = 'agent';

  validate(step: IJobStep, job: IJob, collector: ValidationCollector): void {
    const hasPrompt = isNonEmptyString(step.prompt);
    const hasPromptFile = isNonEmptyString(step.prompt_file);

    if (hasPrompt && hasPromptFile) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' cannot define both prompt and prompt_file`,
      );
      return;
    }

    if (!hasPrompt && !hasPromptFile) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' missing prompt or prompt_file`,
      );
    }
  }
}

class RunCommandStepValidator implements StepTypeValidator {
  readonly type = 'run_command';

  validate(step: IJobStep, job: IJob, collector: ValidationCollector): void {
    if (!isNonEmptyString(step.command)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' with type 'run_command' requires command`,
      );
    }

    this.validateTimeout(step, job, collector);
  }

  private validateTimeout(
    step: IJobStep,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    if (step.timeout_ms === undefined) {
      return;
    }

    if (!isPositiveInteger(step.timeout_ms)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' with type 'run_command' timeout_ms must be a positive integer`,
      );
      return;
    }

    // The run_command handler clamps timeout_ms to RUN_COMMAND_MAX_TIMEOUT_MS.
    // Reject (rather than silently clamp) so a configured timeout the engine
    // cannot honor surfaces at load time instead of as a mid-run kill.
    if (step.timeout_ms > RUN_COMMAND_MAX_TIMEOUT_MS) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' with type 'run_command' timeout_ms ${step.timeout_ms} exceeds the maximum of ${RUN_COMMAND_MAX_TIMEOUT_MS}ms`,
      );
    }
  }
}

class SetVariableStepValidator implements StepTypeValidator {
  readonly type = 'set_variable';

  validate(step: IJobStep, job: IJob, collector: ValidationCollector): void {
    if (!isRecord(step.variables)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' with type 'set_variable' requires variables object`,
      );
    }
  }
}

class WaitStepValidator implements StepTypeValidator {
  readonly type = 'wait';

  validate(step: IJobStep, job: IJob, collector: ValidationCollector): void {
    if (step.timeout_ms === undefined) {
      return;
    }

    if (!isPositiveInteger(step.timeout_ms)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' with type 'wait' timeout_ms must be a positive integer`,
      );
    }
  }
}

function createStepTypeValidators(): Record<JobStepType, StepTypeValidator> {
  const validators: StepTypeValidator[] = [
    new AgentStepValidator(),
    new RunCommandStepValidator(),
    new SetVariableStepValidator(),
    new WaitStepValidator(),
  ];

  const record = {} as Record<JobStepType, StepTypeValidator>;
  for (const validator of validators) {
    record[validator.type] = validator;
  }

  return record;
}

const STEP_TYPE_VALIDATORS = createStepTypeValidators();

function isKnownStepType(type: string): type is JobStepType {
  return Object.hasOwn(STEP_TYPE_VALIDATORS, type);
}

function validateStepType(
  step: IJobStep,
  job: IJob,
  collector: ValidationCollector,
): void {
  const stepRecord = step as unknown as Record<string, unknown>;
  const stepTypeValue = stepRecord.type;

  if (stepTypeValue === undefined) {
    STEP_TYPE_VALIDATORS.agent.validate(step, job, collector);
    return;
  }

  if (typeof stepTypeValue !== 'string') {
    collector.add(
      `Step '${step.id}' in job '${job.id}' has unsupported type '${formatInvalidValue(stepTypeValue)}'`,
    );
    return;
  }

  if (!isKnownStepType(stepTypeValue)) {
    collector.add(
      `Step '${step.id}' in job '${job.id}' has unsupported type '${stepTypeValue}'`,
    );
    return;
  }

  STEP_TYPE_VALIDATORS[stepTypeValue].validate(step, job, collector);
}

function validateOnErrorTarget(
  step: IJobStep,
  stepIds: Set<string>,
  job: IJob,
  collector: ValidationCollector,
): void {
  const stepRecord = step as unknown as Record<string, unknown>;
  const onError = stepRecord.on_error;

  if (onError === undefined) {
    return;
  }

  if (typeof onError !== 'string') {
    collector.add(
      `Step '${step.id}' in job '${job.id}' has invalid on_error value '${formatInvalidValue(onError)}'`,
    );
    return;
  }

  const isGotoTarget = onError.startsWith('goto:');

  if (onError !== 'fail' && onError !== 'continue' && !isGotoTarget) {
    collector.add(
      `Step '${step.id}' in job '${job.id}' has invalid on_error value '${onError}'`,
    );
    return;
  }

  if (!isGotoTarget) {
    return;
  }

  const target = onError.slice('goto:'.length);
  if (!target || !stepIds.has(target)) {
    collector.add(
      `Step '${step.id}' in job '${job.id}' on_error references unknown step '${target}'`,
    );
  }
}

function resolveTransitionTarget(
  transition: Record<string, unknown>,
): string | null {
  return typeof transition.next === 'string' ? transition.next : null;
}

function validateStringTransitionTarget(
  step: IJobStep,
  job: IJob,
  target: string,
  stepIds: Set<string>,
  collector: ValidationCollector,
): void {
  if (target === 'done' || target === 'fail_job') {
    return;
  }

  if (target.startsWith('goto:')) {
    const gotoTarget = target.slice('goto:'.length);
    if (!gotoTarget || !stepIds.has(gotoTarget)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' transitions to unknown step '${gotoTarget}'`,
      );
    }
    return;
  }

  if (!stepIds.has(target)) {
    collector.add(
      `Step '${step.id}' in job '${job.id}' transitions to unknown step '${target}'`,
    );
  }
}

function validateTransitions(
  step: IJobStep,
  stepIds: Set<string>,
  job: IJob,
  collector: ValidationCollector,
): void {
  if (step.transitions === undefined) {
    return;
  }

  if (!Array.isArray(step.transitions)) {
    collector.add(
      `Step '${step.id}' in job '${job.id}' transitions must be an array`,
    );
    return;
  }

  for (const transition of step.transitions) {
    if (!isRecord(transition)) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' transition entry must be an object`,
      );
      continue;
    }

    const target = resolveTransitionTarget(transition);
    if (target === null) {
      collector.add(
        `Step '${step.id}' in job '${job.id}' transition target must be a string`,
      );
      continue;
    }

    validateStringTransitionTarget(step, job, target, stepIds, collector);
  }
}

export function validateExecutionSteps(
  job: IJob,
  collector: ValidationCollector,
): void {
  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    collector.add(`Job '${job.id}' must contain at least one step`);
    return;
  }

  const stepIdCounts = buildStepIdCounts(job.steps);
  const stepIds = new Set(stepIdCounts.keys());

  reportDuplicateStepIds(stepIdCounts, job.id, collector);
  validateIndividualSteps(job, stepIdCounts, stepIds, collector);
}

function buildStepIdCounts(steps: IJobStep[]): Map<string, number> {
  const stepIdCounts = new Map<string, number>();
  for (const step of steps) {
    if (typeof step.id !== 'string' || step.id.length === 0) {
      continue;
    }

    stepIdCounts.set(step.id, (stepIdCounts.get(step.id) ?? 0) + 1);
  }
  return stepIdCounts;
}

function reportDuplicateStepIds(
  stepIdCounts: Map<string, number>,
  jobId: string,
  collector: ValidationCollector,
): void {
  for (const [stepId, count] of stepIdCounts) {
    if (count > 1) {
      collector.add(`Duplicate step ID '${stepId}' in job '${jobId}'`);
    }
  }
}

function validateIndividualSteps(
  job: IJob,
  stepIdCounts: Map<string, number>,
  stepIds: Set<string>,
  collector: ValidationCollector,
): void {
  for (const step of job.steps ?? []) {
    if (!isNonEmptyString(step.id)) {
      collector.add(`Step in job '${job.id}' missing id`);
      continue;
    }

    if ((stepIdCounts.get(step.id) ?? 0) > 1) {
      continue;
    }

    validateStepType(step, job, collector);
    validateMaxLoops(step, job.id, collector);
    validateOnErrorTarget(step, stepIds, job, collector);
    validateTransitions(step, stepIds, job, collector);
  }
}

function validateMaxLoops(
  step: IJobStep,
  jobId: string,
  collector: ValidationCollector,
): void {
  if (step.max_loops !== undefined && !isPositiveInteger(step.max_loops)) {
    collector.add(
      `Step '${step.id}' in job '${jobId}' max_loops must be a positive integer`,
    );
  }
}
