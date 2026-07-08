import { BadRequestException } from '@nestjs/common';
import type { IJob, IJobStep, WorkflowNeed } from '@nexus/core';
import type {
  NormalizedWorkflowNeed,
  WorkflowNeedsContext,
  WorkflowRecordedResult,
} from './workflow-needs.types';

const DEFAULT_REQUIRED_RESULT = 'success' as const;

export function normalizeWorkflowJobNeeds(job: IJob): NormalizedWorkflowNeed[] {
  return normalizeWorkflowNeeds({
    ownerId: job.id,
    ownerKind: 'job',
    needs: job.needs,
    legacyDependsOn: job.depends_on,
  });
}

export function normalizeWorkflowStepNeeds(
  step: IJobStep,
): NormalizedWorkflowNeed[] {
  return normalizeWorkflowNeeds({
    ownerId: step.id,
    ownerKind: 'step',
    needs: step.needs,
    legacyDependsOn: undefined,
  });
}

export function normalizeWorkflowNeeds(params: {
  readonly ownerId: string;
  readonly ownerKind: 'job' | 'step';
  readonly needs?: WorkflowNeed[];
  readonly legacyDependsOn?: string[];
}): NormalizedWorkflowNeed[] {
  if (params.needs !== undefined && params.legacyDependsOn !== undefined) {
    throw new BadRequestException(
      `${capitalize(params.ownerKind)} ${params.ownerId} cannot define both needs and depends_on`,
    );
  }

  if (params.needs !== undefined) {
    if (!Array.isArray(params.needs)) {
      throw new BadRequestException(
        `${capitalize(params.ownerKind)} ${params.ownerId} needs must be an array`,
      );
    }
    return params.needs.map((need) => normalizeNeed(params, need));
  }

  return (params.legacyDependsOn ?? []).map((id) => ({
    id,
    scope: 'job',
    requiredResult: DEFAULT_REQUIRED_RESULT,
    optional: false,
  }));
}

export function buildJobNeedsContext(
  stateVariables: Record<string, unknown>,
): WorkflowNeedsContext {
  const jobs = readRecord(stateVariables.jobs);
  const results = readRecord(readRecord(stateVariables._internal).job_results);

  return Object.fromEntries(
    Object.entries(jobs).map(([jobId, value]) => {
      const jobState = readRecord(value);
      return [
        jobId,
        {
          result: normalizeRecordedResult(results[jobId] ?? jobState.result),
          output: readOptionalRecord(jobState.output),
        },
      ];
    }),
  );
}

export function buildStepNeedsContext(
  stateVariables: Record<string, unknown>,
  jobId: string,
): WorkflowNeedsContext {
  const steps = readRecord(
    readRecord(readRecord(stateVariables.jobs)[jobId]).steps,
  );

  return Object.fromEntries(
    Object.entries(steps).map(([stepId, value]) => {
      const stepState = readRecord(value);
      return [
        stepId,
        {
          result: normalizeStepResult(stepState.status),
          output: readOptionalRecord(stepState.output),
        },
      ];
    }),
  );
}

export function areNeedsSatisfied(params: {
  readonly needs: NormalizedWorkflowNeed[];
  readonly context: WorkflowNeedsContext;
}): boolean {
  return params.needs.every((need) => {
    const entry = params.context[need.id];
    if (!entry) {
      return need.optional;
    }

    return doesNeedAcceptResult(need.requiredResult, entry.result);
  });
}

function normalizeNeed(
  params: {
    readonly ownerId: string;
    readonly ownerKind: 'job' | 'step';
  },
  need: WorkflowNeed,
): NormalizedWorkflowNeed {
  if (typeof need === 'string') {
    if (need.trim().length === 0) {
      throw new BadRequestException(
        `${capitalize(params.ownerKind)} ${params.ownerId} has empty needs entry`,
      );
    }
    return {
      id: need.trim(),
      scope: params.ownerKind,
      requiredResult: DEFAULT_REQUIRED_RESULT,
      optional: false,
    };
  }

  if (!need || typeof need !== 'object' || Array.isArray(need)) {
    throw new BadRequestException(
      `${capitalize(params.ownerKind)} ${params.ownerId} has invalid needs entry`,
    );
  }

  const targetId = params.ownerKind === 'step' ? need.step : need.job;
  if (typeof targetId !== 'string' || targetId.trim().length === 0) {
    throw new BadRequestException(
      `${capitalize(params.ownerKind)} ${params.ownerId} needs entries must reference a ${params.ownerKind === 'step' ? 'step' : 'job'}`,
    );
  }

  return {
    id: targetId.trim(),
    scope: params.ownerKind,
    requiredResult: need.result ?? DEFAULT_REQUIRED_RESULT,
    optional: need.optional === true,
  };
}

function doesNeedAcceptResult(
  policy: NormalizedWorkflowNeed['requiredResult'],
  result: WorkflowRecordedResult,
): boolean {
  if (policy === 'any') {
    return result !== 'unknown';
  }

  if (policy === 'success_or_skipped') {
    return result === 'success' || result === 'skipped';
  }

  return result === policy;
}

function normalizeRecordedResult(value: unknown): WorkflowRecordedResult {
  if (
    value === 'success' ||
    value === 'skipped' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }

  return 'unknown';
}

function normalizeStepResult(value: unknown): WorkflowRecordedResult {
  if (value === 'completed') {
    return 'success';
  }

  if (value === 'failed' || value === 'skipped' || value === 'cancelled') {
    return value;
  }

  return 'unknown';
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
