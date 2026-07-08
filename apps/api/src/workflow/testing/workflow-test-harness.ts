import { WorkflowEngineService } from '../workflow-engine.service';
import { WorkflowDryRunJobOutputResolver } from '../workflow-engine.types';
import {
  WorkflowDryRunExpectation,
  WorkflowTestHarnessResult,
} from './workflow-test-harness.types';

export class WorkflowTestHarness {
  private triggerData: Record<string, unknown> = {};
  private initialState: Record<string, unknown> = {};
  private mockJobOutputs: Record<string, Record<string, unknown>> = {};
  private mockJobOutputResolvers: Record<
    string,
    WorkflowDryRunJobOutputResolver
  > = {};

  constructor(
    private readonly workflowEngine: Pick<
      WorkflowEngineService,
      'startWorkflow'
    >,
    private readonly workflowId: string,
  ) {}

  withTrigger(data: Record<string, unknown>): this {
    this.triggerData = { ...this.triggerData, ...data };
    return this;
  }

  withState(variables: Record<string, unknown>): this {
    this.initialState = { ...this.initialState, ...variables };
    return this;
  }

  mockJob(jobId: string, output: Record<string, unknown>): this {
    this.mockJobOutputs[jobId] = output;
    return this;
  }

  mockJobWith(jobId: string, resolver: WorkflowDryRunJobOutputResolver): this {
    this.mockJobOutputResolvers[jobId] = resolver;
    return this;
  }

  mockStepWith(
    stepOrJobId: string,
    resolver: WorkflowDryRunJobOutputResolver,
  ): this {
    return this.mockJobWith(stepOrJobId, resolver);
  }

  async run(): Promise<WorkflowTestHarnessResult> {
    const triggerPayload = {
      ...this.triggerData,
      __dryRunInitialState: this.initialState,
    };

    const dryRunResult = await this.workflowEngine.startWorkflow(
      this.workflowId,
      triggerPayload,
      this.buildDryRunOptions(),
    );

    if (!isWorkflowDryRunResult(dryRunResult)) {
      throw new Error('Workflow test harness expected a dry-run result');
    }

    return {
      ...dryRunResult,
      triggerData: this.triggerData,
      initialState: this.initialState,
    };
  }

  async runAndAssert(
    expected: WorkflowDryRunExpectation,
  ): Promise<WorkflowTestHarnessResult> {
    const result = await this.run();

    this.assertIncludedJobs(result, expected.includesJobs ?? []);
    this.assertExcludedJobs(result, expected.excludesJobs ?? []);
    this.assertJobConditions(result, expected.jobConditions ?? {});
    this.assertResolvedInputs(result, expected.resolvedInputs ?? {});
    this.assertJobOutputs(result, expected.outputs ?? {});

    return result;
  }

  private assertIncludedJobs(
    result: WorkflowTestHarnessResult,
    includesJobs: string[],
  ): void {
    for (const jobId of includesJobs) {
      if (!result.executionPath.includes(jobId)) {
        throw new Error(`Expected executionPath to include job '${jobId}'`);
      }
    }
  }

  private assertExcludedJobs(
    result: WorkflowTestHarnessResult,
    excludesJobs: string[],
  ): void {
    for (const jobId of excludesJobs) {
      if (result.executionPath.includes(jobId)) {
        throw new Error(`Expected executionPath to exclude job '${jobId}'`);
      }
    }
  }

  private assertJobConditions(
    result: WorkflowTestHarnessResult,
    jobConditions: Record<string, boolean>,
  ): void {
    for (const [jobId, conditionMet] of Object.entries(jobConditions)) {
      const simulation = this.findSimulationByJobId(result, jobId);
      if (simulation.conditionMet !== conditionMet) {
        throw new Error(
          `Expected condition for '${jobId}' to be ${String(conditionMet)}, got ${String(simulation.conditionMet)}`,
        );
      }
    }
  }

  private assertResolvedInputs(
    result: WorkflowTestHarnessResult,
    resolvedInputs: Record<string, Record<string, unknown>>,
  ): void {
    for (const [jobId, expectedInputs] of Object.entries(resolvedInputs)) {
      const simulation = this.findSimulationByJobId(result, jobId);
      assertContains(
        simulation.resolvedInputs,
        expectedInputs,
        `${jobId}.resolvedInputs`,
      );
    }
  }

  private assertJobOutputs(
    result: WorkflowTestHarnessResult,
    outputs: Record<string, Record<string, unknown>>,
  ): void {
    for (const [jobId, expectedOutput] of Object.entries(outputs)) {
      const simulation = this.findSimulationByJobId(result, jobId);
      assertContains(simulation.output, expectedOutput, `${jobId}.output`);
    }
  }

  private findSimulationByJobId(
    result: WorkflowTestHarnessResult,
    jobId: string,
  ): WorkflowTestHarnessResult['jobSimulations'][number] {
    const simulation = result.jobSimulations.find(
      (item) => item.jobId === jobId,
    );
    if (!simulation) {
      throw new Error(`Expected job simulation '${jobId}' to exist`);
    }

    return simulation;
  }

  private buildDryRunOptions(): {
    dryRun: true;
    mockJobOutputs?: Record<string, Record<string, unknown>>;
    mockJobOutputResolvers?: Record<string, WorkflowDryRunJobOutputResolver>;
  } {
    const options: {
      dryRun: true;
      mockJobOutputs?: Record<string, Record<string, unknown>>;
      mockJobOutputResolvers?: Record<string, WorkflowDryRunJobOutputResolver>;
    } = {
      dryRun: true,
    };

    if (Object.keys(this.mockJobOutputs).length > 0) {
      options.mockJobOutputs = this.mockJobOutputs;
    }

    if (Object.keys(this.mockJobOutputResolvers).length > 0) {
      options.mockJobOutputResolvers = this.mockJobOutputResolvers;
    }

    return options;
  }
}

function isWorkflowDryRunResult(
  value: unknown,
): value is WorkflowTestHarnessResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.dryRun === true && Array.isArray(record.executionPath);
}

function assertContains(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  path: string,
): void {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const nextPath = `${path}.${key}`;
    const actualValue = actual[key];

    if (
      expectedValue &&
      typeof expectedValue === 'object' &&
      !Array.isArray(expectedValue)
    ) {
      if (
        !actualValue ||
        typeof actualValue !== 'object' ||
        Array.isArray(actualValue)
      ) {
        throw new Error(`Expected object at '${nextPath}'`);
      }
      assertContains(
        actualValue as Record<string, unknown>,
        expectedValue as Record<string, unknown>,
        nextPath,
      );
      continue;
    }

    if (actualValue !== expectedValue) {
      throw new Error(
        `Expected '${nextPath}' to be '${String(expectedValue)}', got '${String(actualValue)}'`,
      );
    }
  }
}

export function workflowTest(
  workflowEngine: Pick<WorkflowEngineService, 'startWorkflow'>,
  workflowId: string,
): WorkflowTestHarness {
  return new WorkflowTestHarness(workflowEngine, workflowId);
}
