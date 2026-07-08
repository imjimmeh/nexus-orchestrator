import { Injectable, Inject, Logger } from '@nestjs/common';
import Handlebars from 'handlebars';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { getNestedValue, IWorkflowRun } from '@nexus/core';
import { registerComparisonHelpers } from './workflow-comparison-helpers';
import { registerBooleanHelpers } from './workflow-boolean-helpers';
import { registerDateHelpers } from './workflow-date-helpers';

const hbs = Handlebars.create();
hbs.registerHelper('json', (context: unknown) => JSON.stringify(context));
hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hbs.registerHelper('or', (...args: unknown[]) => {
  const values = getVariadicHelperArguments(args);
  return values.reduce<unknown>((acc, value) => acc || value, undefined);
});
hbs.registerHelper('and', (...args: unknown[]) => {
  const values = getVariadicHelperArguments(args);
  if (values.length === 0) {
    return false;
  }

  return values.reduce<unknown>((acc, value) => acc && value, true);
});
hbs.registerHelper('not', (a: unknown) => !a);
hbs.registerHelper('length', (value: unknown) =>
  Array.isArray(value) ? value.length : 0,
);
registerComparisonHelpers(hbs);
registerBooleanHelpers(hbs);
registerDateHelpers(hbs);

@Injectable()
export class StateManagerService {
  private readonly logger = new Logger(StateManagerService.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepo: IWorkflowRunRepository,
  ) {}

  async setVariable(
    workflowRunId: string,
    key: string,
    value: unknown,
  ): Promise<IWorkflowRun | null> {
    await this.workflowRunRepo.setStateVariableAtomic(
      workflowRunId,
      key,
      value,
    );
    return this.workflowRunRepo.findById(workflowRunId);
  }

  async deleteVariable(workflowRunId: string, key: string): Promise<void> {
    await this.workflowRunRepo.deleteStateVariableAtomic(workflowRunId, key);
  }

  async getVariable(workflowRunId: string, key: string): Promise<unknown> {
    const run = await this.workflowRunRepo.findById(workflowRunId);
    if (!run) return null;

    return getNestedValue(run.state_variables, key.split('.'));
  }

  async getStateVariables(
    workflowRunId: string,
  ): Promise<Record<string, unknown>> {
    const run = await this.workflowRunRepo.findById(workflowRunId);
    if (!run || !run.state_variables) {
      return {};
    }

    return run.state_variables;
  }

  tryMarkJobQueued(workflowRunId: string, jobId: string): Promise<boolean> {
    return this.workflowRunRepo.tryMarkJobQueued(workflowRunId, jobId);
  }

  tryMarkJobCompleted(workflowRunId: string, jobId: string): Promise<boolean> {
    return this.workflowRunRepo.tryMarkJobCompleted(workflowRunId, jobId);
  }

  substituteTemplate(
    template: string,
    variables: Record<string, unknown>,
  ): string {
    const rewrittenTemplate = this.rewriteLegacyStepTemplates(template);
    const enrichedVariables = this.enrichVariablesWithStepsShortcut(variables);

    try {
      const compiled = hbs.compile(rewrittenTemplate, { noEscape: true });
      return compiled(enrichedVariables);
    } catch (error) {
      const message = `Failed to render template "${template}": ${(error as Error).message}`;
      this.logger.error(message);
      throw new Error(message, { cause: error });
    }
  }

  /**
   * Enrich variables so that `{{steps.X}}` resolves to the current job's
   * steps, with a fallback to the top-level `jobs` map for legacy
   * `{{steps.jobId.output}}` patterns.
   */
  private enrichVariablesWithStepsShortcut(
    variables: Record<string, unknown>,
  ): Record<string, unknown> {
    const currentJobId = getNestedValue(
      variables,
      '_internal.current_job_id'.split('.'),
    ) as string | undefined;

    if (typeof currentJobId !== 'string') {
      return variables;
    }

    const jobSteps = getNestedValue(
      variables,
      `jobs.${currentJobId}.steps`.split('.'),
    );

    if (jobSteps && typeof jobSteps === 'object') {
      return {
        ...variables,
        steps: { ...(jobSteps as Record<string, unknown>) },
      };
    }

    const jobs = getNestedValue(variables, 'jobs'.split('.'));
    if (jobs && typeof jobs === 'object') {
      return { ...variables, steps: jobs };
    }

    return variables;
  }

  /**
   * Rewrite legacy internal key aliases to current key names.
   * {{_internal.completed_steps.X}} -> {{_internal.completed_jobs.X}}
   * {{_internal.queued_steps.X}} -> {{_internal.queued_jobs.X}}
   */
  private rewriteLegacyStepTemplates(template: string): string {
    return template
      .replaceAll(
        /\{\{_internal\.completed_steps\./g,
        '{{_internal.completed_jobs.',
      )
      .replaceAll(/\{\{_internal\.queued_steps\./g, '{{_internal.queued_jobs.');
  }

  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ) {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[keys.at(-1) as string] = value;
  }
}

function getVariadicHelperArguments(args: unknown[]): unknown[] {
  if (args.length === 0) {
    return [];
  }

  return args.slice(0, -1);
}
