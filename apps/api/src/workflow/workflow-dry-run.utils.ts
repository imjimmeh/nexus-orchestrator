import { asRecord, IWorkflowDefinition } from '@nexus/core';
import Handlebars from 'handlebars';
import { registerComparisonHelpers } from './workflow-comparison-helpers';
import { DAGResolverService } from './dag-resolver.service';
import {
  WorkflowDryRunJobOutputResolver,
  WorkflowDryRunJobSimulation,
  WorkflowDryRunResult,
} from './workflow-engine.types';
import { resolveTemplatedInputs } from './workflow-step-execution/step-support-inputs.helpers';

const dryRunHandlebars = Handlebars.create();
dryRunHandlebars.registerHelper('json', (context: unknown) =>
  JSON.stringify(context),
);
dryRunHandlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
dryRunHandlebars.registerHelper('or', (...args: unknown[]) => {
  const values = getVariadicHelperArguments(args);
  return values.reduce<unknown>((acc, value) => acc || value, undefined);
});
dryRunHandlebars.registerHelper('and', (...args: unknown[]) => {
  const values = getVariadicHelperArguments(args);
  if (values.length === 0) {
    return false;
  }

  return values.reduce<unknown>((acc, value) => acc && value, true);
});
dryRunHandlebars.registerHelper('not', (a: unknown) => !a);
dryRunHandlebars.registerHelper('length', (value: unknown) =>
  Array.isArray(value) ? value.length : 0,
);
registerComparisonHelpers(dryRunHandlebars);

export function buildWorkflowDryRunResult(params: {
  workflowId: string;
  triggerData: Record<string, unknown>;
  definition: IWorkflowDefinition;
  mockJobOutputs: Record<string, Record<string, unknown>>;
  mockJobOutputResolvers?: Record<string, WorkflowDryRunJobOutputResolver>;
  dagResolver: Pick<
    DAGResolverService,
    'buildDependencyGraph' | 'findParallelJobs'
  >;
}): Promise<WorkflowDryRunResult> {
  const jobs = params.definition.jobs ?? [];
  const graph = params.dagResolver.buildDependencyGraph(jobs);
  const parallelGroups = params.dagResolver.findParallelJobs(graph);
  const executionPath =
    parallelGroups.length > 0
      ? parallelGroups.flat()
      : jobs.map((job) => job.id);

  const stateTransitions = jobs
    .map((job) => {
      const inputs = asRecord(job.inputs);
      if (job.type === 'http_webhook') {
        const body = asRecord(inputs?.body);
        return typeof body?.status === 'string' ? body.status : null;
      }
      return null;
    })
    .filter((value): value is string => value !== null);

  const mockJobsApplied = Object.keys(params.mockJobOutputs)
    .filter((jobId) => jobs.some((job) => job.id === jobId))
    .sort((a, b) => a.localeCompare(b));

  const jobSimulationsPromise = simulateJobs({
    executionPath,
    jobs,
    workflowId: params.workflowId,
    workflowName: params.definition.name,
    triggerData: params.triggerData,
    mockJobOutputs: params.mockJobOutputs,
    mockJobOutputResolvers: params.mockJobOutputResolvers ?? {},
  });

  return jobSimulationsPromise.then((jobSimulations) => {
    const resolverApplied = jobSimulations
      .filter((simulation) => simulation.outputSource === 'resolver')
      .map((simulation) => simulation.jobId);

    const allApplied = [
      ...new Set([...mockJobsApplied, ...resolverApplied]),
    ].sort((left, right) => left.localeCompare(right));

    return {
      dryRun: true,
      workflowId: params.workflowId,
      workflowName: params.definition.name,
      executionPath,
      parallelGroups,
      stateTransitions,
      mockJobsApplied: allApplied,
      jobSimulations,
    };
  });
}

async function simulateJobs(params: {
  executionPath: string[];
  jobs: IWorkflowDefinition['jobs'];
  workflowId: string;
  workflowName: string;
  triggerData: Record<string, unknown>;
  mockJobOutputs: Record<string, Record<string, unknown>>;
  mockJobOutputResolvers: Record<string, WorkflowDryRunJobOutputResolver>;
}): Promise<WorkflowDryRunJobSimulation[]> {
  const initialState =
    params.triggerData.__dryRunInitialState &&
    typeof params.triggerData.__dryRunInitialState === 'object' &&
    !Array.isArray(params.triggerData.__dryRunInitialState)
      ? (params.triggerData.__dryRunInitialState as Record<string, unknown>)
      : {};

  const variables: Record<string, unknown> = {
    ...initialState,
    trigger: params.triggerData,
    jobs: {},
  };
  const jobOutputs: Record<string, Record<string, unknown>> = {};
  const jobSimulations: WorkflowDryRunJobSimulation[] = [];

  for (const jobId of params.executionPath) {
    const job = (params.jobs ?? []).find((candidate) => candidate.id === jobId);
    if (!job) {
      continue;
    }

    const forEachResolvedInputs = resolveForEachInputs(
      job.for_each,
      job.inputs,
      variables,
    );
    const resolvedInputs =
      forEachResolvedInputs?.[0] ??
      resolveTemplatedInputs(job.inputs, variables, (value) =>
        substituteTemplate(value, variables),
      );

    const conditionMet = evaluateJobCondition(job.condition, variables);
    if (!conditionMet) {
      const skippedOutput = { skipped: true };
      jobOutputs[jobId] = skippedOutput;
      (variables.jobs as Record<string, unknown>)[jobId] = {
        output: skippedOutput,
        inputs: resolvedInputs,
      };

      jobSimulations.push({
        jobId,
        jobType: job.type,
        conditionMet,
        resolvedInputs,
        forEachResolvedInputs,
        output: skippedOutput,
        outputSource: 'default',
      });
      continue;
    }

    const outputResult = await resolveJobOutput({
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      jobId,
      jobType: job.type,
      resolvedInputs,
      triggerData: params.triggerData,
      jobOutputs,
      mockJobOutputs: params.mockJobOutputs,
      mockJobOutputResolvers: params.mockJobOutputResolvers,
    });

    jobOutputs[jobId] = outputResult.output;
    (variables.jobs as Record<string, unknown>)[jobId] = {
      output: outputResult.output,
      inputs: resolvedInputs,
    };

    jobSimulations.push({
      jobId,
      jobType: job.type,
      conditionMet,
      resolvedInputs,
      forEachResolvedInputs,
      output: outputResult.output,
      outputSource: outputResult.source,
    });
  }

  return jobSimulations;
}

function evaluateJobCondition(
  condition: string | undefined,
  variables: Record<string, unknown>,
): boolean {
  if (!condition) {
    return true;
  }

  const rendered = substituteTemplate(condition, variables).trim();
  if (rendered === 'true') {
    return true;
  }

  if (rendered === 'false') {
    return false;
  }

  return evaluateEqualityExpression(rendered);
}

function evaluateEqualityExpression(expression: string): boolean {
  const operations = [
    { regex: /^(?<left>.+?)\s*===\s*(?<right>.+)$/, expectEqual: true },
    { regex: /^(?<left>.+?)\s*==\s*(?<right>.+)$/, expectEqual: true },
    { regex: /^(?<left>.+?)\s*!==\s*(?<right>.+)$/, expectEqual: false },
    { regex: /^(?<left>.+?)\s*!=\s*(?<right>.+)$/, expectEqual: false },
  ] as const;

  for (const operation of operations) {
    const match = operation.regex.exec(expression);
    if (!match?.groups) {
      continue;
    }

    const left = normalizeConditionOperand(match.groups.left);
    const right = normalizeConditionOperand(match.groups.right);
    return operation.expectEqual ? left === right : left !== right;
  }

  return false;
}

function normalizeConditionOperand(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function resolveJobOutput(params: {
  workflowId: string;
  workflowName: string;
  jobId: string;
  jobType: string;
  resolvedInputs: Record<string, unknown>;
  triggerData: Record<string, unknown>;
  jobOutputs: Record<string, Record<string, unknown>>;
  mockJobOutputs: Record<string, Record<string, unknown>>;
  mockJobOutputResolvers: Record<string, WorkflowDryRunJobOutputResolver>;
}): Promise<{
  output: Record<string, unknown>;
  source: 'resolver' | 'mock' | 'default';
}> {
  const resolver = params.mockJobOutputResolvers[params.jobId];
  if (resolver) {
    const output = await resolver({
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      jobId: params.jobId,
      jobType: params.jobType,
      resolvedInputs: params.resolvedInputs,
      triggerData: params.triggerData,
      jobOutputs: params.jobOutputs,
    });

    return {
      output,
      source: 'resolver',
    };
  }

  const mockedOutput = params.mockJobOutputs[params.jobId];
  if (mockedOutput) {
    return {
      output: mockedOutput,
      source: 'mock',
    };
  }

  return {
    output: {},
    source: 'default',
  };
}

function substituteTemplate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return dryRunHandlebars.compile(template, { noEscape: true })(variables);
}

function getVariadicHelperArguments(args: unknown[]): unknown[] {
  if (args.length === 0) {
    return [];
  }

  const values: unknown[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    values.push(args[index]);
  }

  return values;
}

function resolveForEachInputs(
  forEachExpression: unknown,
  inputs: unknown,
  variables: Record<string, unknown>,
): Record<string, unknown>[] | undefined {
  const items = resolveForEachItems(forEachExpression, variables);
  if (!items) {
    return undefined;
  }

  return items.map((item, itemIndex) => {
    const iterationVariables: Record<string, unknown> = {
      ...variables,
      item,
      item_index: itemIndex,
    };

    return resolveTemplatedInputs(
      asRecord(inputs),
      iterationVariables,
      (value) => substituteTemplate(value, iterationVariables),
    );
  });
}

function resolveForEachItems(
  forEachExpression: unknown,
  variables: Record<string, unknown>,
): unknown[] | undefined {
  if (!forEachExpression) {
    return undefined;
  }

  if (Array.isArray(forEachExpression)) {
    const items: unknown[] = [];
    for (const item of forEachExpression) {
      items.push(item);
    }

    return items;
  }

  const resolved = resolveTemplatedInputs(
    { items: forEachExpression },
    variables,
    (value) => substituteTemplate(value, variables),
  );

  const items = resolved.items;
  if (Array.isArray(items)) {
    const normalizedItems: unknown[] = [];
    for (const item of items) {
      normalizedItems.push(item);
    }

    return normalizedItems;
  }

  return undefined;
}
