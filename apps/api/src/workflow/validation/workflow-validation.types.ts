import { IJob, IWorkflowDefinition } from '@nexus/core';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidationContext {
  definition: IWorkflowDefinition;
  jobs: IJob[];
  jobIds: Set<string>;
  jobIdCounts: Map<string, number>;
  toolExistsCache: Map<string, boolean>;
  skipGraphValidation: boolean;
}

export interface WorkflowValidator {
  validate(
    context: ValidationContext,
    collector: ValidationCollector,
  ): Promise<void> | void;
}

export interface ValidationCollector {
  add(message: string, code?: string, path?: string): void;
  /**
   * Records a non-fatal validation issue (e.g. a YAML-declared skill name
   * that doesn't exist yet — it may be authored later). Warnings never flip
   * `hasErrors()`/`valid` and are surfaced separately via
   * {@link toWarningMessages}.
   */
  addWarning(message: string, code?: string, path?: string): void;
  hasErrors(): boolean;
  toMessages(): string[];
  toWarningMessages(): string[];
}

export function createValidationContext(
  definition: IWorkflowDefinition,
): ValidationContext {
  const jobs = Array.isArray(definition.jobs) ? definition.jobs : [];
  const jobIdCounts = new Map<string, number>();
  const jobIds = new Set<string>();

  for (const job of jobs) {
    if (typeof job.id === 'string' && job.id.length > 0) {
      jobIds.add(job.id);
      jobIdCounts.set(job.id, (jobIdCounts.get(job.id) ?? 0) + 1);
    }
  }

  return {
    definition,
    jobs,
    jobIds,
    jobIdCounts,
    toolExistsCache: new Map<string, boolean>(),
    skipGraphValidation: false,
  };
}
