import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkflowEngineService } from '../workflow-engine.service';
import { WorkflowParserService } from '../workflow-parser.service';
import { WorkflowValidationService } from '../workflow-validation.service';
import { DAGResolverService } from '../dag-resolver.service';
import { PromptLoaderService } from '../prompt-loader.service';
import { WorkflowPersistenceService } from '../workflow-persistence.service';
import { WorkflowConcurrencyManager } from '../workflow-concurrency-manager.service';
import { WorkflowLaunchDedupeService } from '../workflow-launch-dedupe.service';
import { WorkflowDefinitionLoaderService } from '../workflow-definition-loader.service';
import { WorkflowEngineLaunchOrchestratorService } from '../workflow-engine-launch-orchestrator.service';
import type { SpecialStepHandlerLookup } from '../workflow-special-steps/step-special-step.types';

function loadWorkflowYaml(fileName: string): string {
  const workflowPath = path.resolve(
    __dirname,
    '../../../../../seed/workflows',
    fileName,
  );

  return fs.readFileSync(workflowPath, 'utf8');
}

function createDryRunEngine(params: { workflowId: string; yaml: string }) {
  const workflowRepo = {
    findById: vi.fn().mockResolvedValue({
      id: params.workflowId,
      is_active: true,
      yaml_definition: params.yaml,
    }),
    findByIdentifier: vi.fn().mockResolvedValue({
      id: params.workflowId,
      is_active: true,
      yaml_definition: params.yaml,
    }),
    findAll: vi.fn().mockResolvedValue([]),
    findPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn(),
    update: vi.fn(),
  };

  const runRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    findPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findByWorkflowId: vi.fn().mockResolvedValue([]),
    findByScopeId: vi.fn().mockResolvedValue([]),
    findByWorkflowAndScopeId: vi.fn().mockResolvedValue([]),
    findActiveByTriggerContext: vi.fn().mockResolvedValue(null),
    findLatestByWorkflowAndDedupeKey: vi.fn().mockResolvedValue(null),
    countActiveByScope: vi.fn().mockResolvedValue(0),
    findOldestPendingByScope: vi.fn().mockResolvedValue(null),
    findOldestRunningByScope: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
  };

  const dagResolver = new DAGResolverService();
  const parser = new WorkflowParserService();
  const promptLoader = new PromptLoaderService();
  const specialStepRegistry: SpecialStepHandlerLookup = {
    getHandler: vi.fn().mockReturnValue(null),
  };
  const validator = new WorkflowValidationService(
    {
      findByName: vi.fn().mockResolvedValue({ id: 'tool', name: 'any-tool' }),
    } as never,
    dagResolver,
    specialStepRegistry,
  );

  const yamlValidator = {
    validateAndThrow: vi.fn().mockReturnValue(undefined),
  };
  const eventLog = { appendBestEffort: vi.fn().mockResolvedValue(undefined) };
  const runExecution = {
    emitRunStatusChanged: vi.fn(),
    enqueueJob: vi.fn().mockResolvedValue(undefined),
    handleJobComplete: vi.fn().mockResolvedValue(undefined),
  };
  const concurrencyPolicy = {
    checkAndApply: vi
      .fn()
      .mockResolvedValue({ action: 'proceed', concurrencyScope: 'global' }),
    resolveConcurrencyScope: vi.fn().mockReturnValue('global'),
  };
  const jobMessageQueue = {
    resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
    retryJobWithMessage: vi.fn().mockResolvedValue(undefined),
  };

  const repos = {
    workflows: workflowRepo,
    runs: runRepo,
    agentProfiles: {},
  };

  const persistence = new WorkflowPersistenceService(
    repos as never,
    parser,
    validator,
    yamlValidator as never,
  );
  const workflowDefinitionLoader = new WorkflowDefinitionLoaderService(
    parser,
    promptLoader,
    validator,
  );

  const concurrency = new WorkflowConcurrencyManager(
    concurrencyPolicy as never,
    runRepo as never,
    eventLog as never,
  );
  const launchDedupe = new WorkflowLaunchDedupeService(runRepo as never);

  const variableResolver = {
    resolveContext: vi.fn(async (_scopeId: string | null) => ({})),
  };

  const cancellationCascade = {
    cancelRun: vi.fn().mockResolvedValue(undefined),
  };

  const launchOrchestrator = new WorkflowEngineLaunchOrchestratorService(
    persistence,
    concurrency,
    dagResolver,
    runExecution as never,
    eventLog as never,
    launchDedupe,
    cancellationCascade,
    variableResolver as never,
  );

  const engine = new WorkflowEngineService(
    persistence,
    workflowDefinitionLoader,
    runExecution as never,
    eventLog as never,
    launchDedupe,
    jobMessageQueue as never,
    cancellationCascade,
    launchOrchestrator,
  );

  return { engine, runRepo };
}

describe('Workflow dry-run definitions', () => {
  it('supports callback-based job outputs resolved from inputs and prior outputs', async () => {
    const yaml = `
workflow_id: callback_test
name: Callback Test
trigger:
  type: manual
jobs:
  - id: step_a
    type: execution
    tier: heavy
    inputs:
      request: "{{ trigger.request }}"
    steps:
      - id: run_a
        prompt: "A"
  - id: step_b
    type: execution
    tier: heavy
    depends_on: [step_a]
    inputs:
      from_a: "{{ jobs.step_a.output.result }}"
      suffix: "{{ trigger.suffix }}"
    steps:
      - id: run_b
        prompt: "B"
`;

    const { engine } = createDryRunEngine({
      workflowId: 'wf-callback-test',
      yaml,
    });

    const result = await engine.startWorkflow(
      'wf-callback-test',
      {
        request: 'alpha',
        suffix: 'omega',
      },
      {
        dryRun: true,
        mockJobOutputResolvers: {
          step_a: ({ resolvedInputs }) => ({
            result: `${String(resolvedInputs.request)}-done`,
          }),
          step_b: ({ resolvedInputs }) => ({
            final: `${String(resolvedInputs.from_a)}-${String(resolvedInputs.suffix)}`,
          }),
        },
      },
    );

    expect(result.mockJobsApplied).toEqual(['step_a', 'step_b']);
    expect(result.jobSimulations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: 'step_a',
          outputSource: 'resolver',
          resolvedInputs: { request: 'alpha' },
          output: { result: 'alpha-done' },
        }),
        expect.objectContaining({
          jobId: 'step_b',
          outputSource: 'resolver',
          resolvedInputs: { from_a: 'alpha-done', suffix: 'omega' },
          output: { final: 'alpha-done-omega' },
        }),
      ]),
    );
  });

  it('covers project orchestration cycle decision path', async () => {
    const yaml = loadWorkflowYaml(
      'project-orchestration-cycle-ceo.workflow.yaml',
    );
    const { engine } = createDryRunEngine({
      workflowId: 'wf-orchestration-cycle',
      yaml,
    });

    const result = await engine.startWorkflow(
      'wf-orchestration-cycle',
      { scope_id: 'project-1' },
      { dryRun: true },
    );

    expect(result.executionPath).toContain('dispatch');
  });

  it('covers project discovery delegation path', async () => {
    const yaml = loadWorkflowYaml('project-discovery-ceo.workflow.yaml');
    const { engine } = createDryRunEngine({
      workflowId: 'wf-discovery',
      yaml,
    });

    const result = await engine.startWorkflow(
      'wf-discovery',
      { scope_id: 'project-1', orchestrationId: 'orch-1' },
      { dryRun: true },
    );

    expect(result.executionPath).toContain('discovery_and_specs');
    expect(result.executionPath).toContain('emit_specs_ready');
  });
});
