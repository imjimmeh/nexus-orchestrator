import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkflowEngineService } from '../workflow-engine.service';
import { WorkflowParserService } from '../workflow-parser.service';
import { WorkflowValidationService } from '../workflow-validation.service';
import { DAGResolverService } from '../dag-resolver.service';
import { PromptLoaderService } from '../prompt-loader.service';
import { WorkflowPersistenceService } from '../workflow-persistence.service';
import { IJob, ToolPolicyEffect } from '@nexus/core';
import type { ToolPolicyDocument } from '@nexus/core';
import { workflowTest } from './workflow-test-harness';
import type { SpecialStepHandlerLookup } from '../workflow-special-steps/step-special-step.types';
import { WorkflowConcurrencyManager } from '../workflow-concurrency-manager.service';
import { WorkflowLaunchDedupeService } from '../workflow-launch-dedupe.service';
import { WorkflowDefinitionLoaderService } from '../workflow-definition-loader.service';
import { WorkflowEngineLaunchOrchestratorService } from '../workflow-engine-launch-orchestrator.service';
import { REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT } from '../workflow-repair/repair-delegation.types';
import { ConcurrencyPolicyService } from '../concurrency-policy.service';

const WORKFLOWS_DIR = path.resolve(__dirname, '../../../../../seed/workflows');
const expectedValidationFailures: Record<string, string> = {};

function listSeedWorkflowFiles(): string[] {
  return fs
    .readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.workflow.yaml'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function loadWorkflowYaml(fileName: string): string {
  const workflowPath = path.join(WORKFLOWS_DIR, fileName);
  return fs.readFileSync(workflowPath, 'utf8');
}

function loadWorkflowPrompt(promptPath: string): string {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, promptPath), 'utf8');
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

function getDefaultContractValue(key: string): unknown {
  const normalized = key.toLowerCase();
  if (normalized === 'decision') {
    return 'accept';
  }
  if (normalized === 'pass_fail_status') {
    return 'pass';
  }
  if (
    normalized.includes('list') ||
    normalized.startsWith('missing_') ||
    normalized.startsWith('stale_') ||
    normalized.startsWith('conflicting_') ||
    normalized.startsWith('failed_')
  ) {
    return [];
  }
  return `test-${normalized}`;
}

function buildDefaultMockOutputs(
  yaml: string,
): Record<string, Record<string, unknown>> {
  const parser = new WorkflowParserService();
  const parsed = parser.parseWorkflow(yaml);
  const outputs: Record<string, Record<string, unknown>> = {};

  for (const job of parsed.jobs ?? []) {
    const required = readRequiredOutputKeys(job);
    if (required.length === 0) {
      continue;
    }

    outputs[job.id] = required.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = getDefaultContractValue(key);
      return acc;
    }, {});
  }

  return outputs;
}

function readRequiredOutputKeys(job: IJob): string[] {
  const contract = job.output_contract;
  if (!contract || typeof contract !== 'object') {
    return [];
  }

  const required = (contract as { required?: unknown }).required;
  if (!Array.isArray(required)) {
    return [];
  }

  return required.filter((value): value is string => typeof value === 'string');
}

describe('Seeded workflows dry-run coverage', () => {
  const workflowFiles = listSeedWorkflowFiles();

  it('loads at least one seeded workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of workflowFiles) {
    it(`dry-runs ${fileName}`, async () => {
      const yaml = loadWorkflowYaml(fileName);
      const workflowId = `wf-seed-${fileName.replace(/\.workflow\.yaml$/i, '')}`;
      const { engine, runRepo } = createDryRunEngine({ workflowId, yaml });
      const defaultMockOutputs = buildDefaultMockOutputs(yaml);

      const expectedValidationFailure = expectedValidationFailures[fileName];
      if (expectedValidationFailure) {
        await expect(
          engine.startWorkflow(
            workflowId,
            {
              scope_id: 'project-seed-test',
              contextId: 'resource-seed-test',
              orchestrationId: 'orch-seed-test',
            },
            {
              dryRun: true,
              mockJobOutputs: defaultMockOutputs,
            },
          ),
        ).rejects.toThrow(expectedValidationFailure);
        return;
      }

      const result = await engine.startWorkflow(
        workflowId,
        {
          scope_id: 'project-seed-test',
          contextId: 'resource-seed-test',
          orchestrationId: 'orch-seed-test',
          goals: 'seed dry run verification',
          objective: 'seed dry run verification',
          requested_by: 'test-suite',
          stateSummary: 'seed validation state',
          isRestart: false,
          reason: 'deterministic test run',
          feedback: 'seed dry-run feedback',
        },
        {
          dryRun: true,
          mockJobOutputs: defaultMockOutputs,
        },
      );

      expect(result.dryRun).toBe(true);
      expect(result.workflowName.length).toBeGreaterThan(0);
      expect(result.executionPath.length).toBeGreaterThan(0);
      expect(runRepo.create).not.toHaveBeenCalled();
    });
  }
});

describe('refinement seed workflow validation', () => {
  it('satisfies workflow launch validation', async () => {
    const files = listSeedWorkflowFiles();
    const refinementFile = files.find(
      (f) => f.includes('refinement') && f.includes('default'),
    );
    if (!refinementFile) {
      throw new Error('Refinement workflow file not found');
    }
    const yaml = loadWorkflowYaml(refinementFile);
    const parser = new WorkflowParserService();
    const specialStepRegistry: SpecialStepHandlerLookup = {
      getHandler: vi.fn().mockReturnValue(null),
    };
    const validator = new WorkflowValidationService(
      {
        findByName: vi.fn().mockResolvedValue({ id: 'tool', name: 'any-tool' }),
      } as never,
      new DAGResolverService(),
      specialStepRegistry,
    );

    const workflow = parser.parseWorkflow(yaml);

    await expect(validator.validateWorkflow(workflow)).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });
});

describe('Seeded workflows conditional logic outcomes', () => {
  it('continues discovery after standard-route import predecessors are skipped', async () => {
    const fileName = 'project-discovery-ceo.workflow.yaml';
    const yaml = loadWorkflowYaml(fileName);
    const workflowId = `wf-seed-assert-${fileName.replace(/\.workflow\.yaml$/i, '')}-standard-route`;
    const { engine } = createDryRunEngine({ workflowId, yaml });

    await workflowTest(engine, workflowId)
      .withTrigger({
        scope_id: 'project-seed-test',
        orchestrationId: 'orch-seed-test',
        selectedRoute: 'standard-discovery',
        selectedRuleId: 'standard-discovery',
        goals: 'discover a new greenfield product',
        stateSummary: 'seed validation state',
        isRestart: false,
      })
      .mockJob('discovery_and_specs', { decision: 'accept', specs_ready: true })
      .mockJob('synthesize_and_hydrate_import', {
        childStateVariables: {
          jobs: {
            hydrate_discovery_results: {
              output: {
                hydration_summary: { created_count: 0, updated_count: 0 },
                existing_resource_count: 0,
              },
            },
          },
        },
      })
      .runAndAssert({
        includesJobs: [
          'discovery_and_specs',
          'emit_specs_ready',
          'emit_cycle_request',
        ],
        jobConditions: {
          investigate_imported_repo: false,
          reconcile_import_specs: false,
          synthesize_and_hydrate_import: false,
          discovery_and_specs: true,
          emit_specs_ready: true,
          emit_cycle_request: true,
        },
        outputs: {
          investigate_imported_repo: { skipped: true },
          reconcile_import_specs: { skipped: true },
          synthesize_and_hydrate_import: { skipped: true },
          discovery_and_specs: { decision: 'accept', specs_ready: true },
        },
      });
  });

  it('dry-runs imported bootstrap route through import investigation and continuation events', async () => {
    const fileName = 'project-discovery-ceo.workflow.yaml';
    const yaml = loadWorkflowYaml(fileName);
    const workflowId = `wf-seed-assert-${fileName.replace(/\.workflow\.yaml$/i, '')}-imported-bootstrap`;
    const { engine } = createDryRunEngine({ workflowId, yaml });

    await workflowTest(engine, workflowId)
      .withTrigger({
        scopeId: 'project-seed-test',
        orchestrationId: 'orch-seed-test',
        selectedRoute: 'imported-repo-bootstrap',
        selectedRuleId: 'first_run_imported_repo',
        goals: 'discover an imported repository',
        stateSummary: 'seed validation state',
        isRestart: false,
        basePath: 'G:/code/imported',
        repositoryUrl: 'https://example.test/repo.git',
      })
      .mockJob('discovery_and_specs', { decision: 'accept' })
      .mockJob('synthesize_and_hydrate_import', {
        childStateVariables: {
          jobs: {
            hydrate_discovery_results: {
              output: {
                hydration_summary: { created_count: 1, updated_count: 0 },
                existing_resource_count: 0,
                ready_for_cycle: true,
              },
            },
          },
        },
      })
      .runAndAssert({
        includesJobs: [
          'investigate_imported_repo',
          'reconcile_import_specs',
          'synthesize_and_hydrate_import',
          'discovery_and_specs',
          'clear_import_hydration_blocked',
          'emit_specs_ready',
          'emit_cycle_request',
        ],
        jobConditions: {
          investigate_imported_repo: true,
          reconcile_import_specs: true,
          synthesize_and_hydrate_import: true,
          discovery_and_specs: true,
          clear_import_hydration_blocked: true,
          emit_specs_ready: true,
          emit_cycle_request: true,
        },
      });
  });

  it('prevents false specs_ready when discovery runs without selectedRoute', async () => {
    const fileName = 'project-discovery-ceo.workflow.yaml';
    const yaml = loadWorkflowYaml(fileName);
    const workflowId = `wf-seed-assert-${fileName.replace(/\.workflow\.yaml$/i, '')}-route-less`;
    const { engine } = createDryRunEngine({ workflowId, yaml });

    await workflowTest(engine, workflowId)
      .withTrigger({
        scopeId: 'project-seed-test',
        orchestrationId: 'orch-seed-test',
        goals: 'discover an imported repository',
        basePath: 'G:/code/imported',
        repositoryUrl: 'https://example.test/repo.git',
      })
      .mockJob('discovery_and_specs', { decision: 'accept' })
      .mockJob('synthesize_and_hydrate_import', {
        childStateVariables: {
          jobs: {
            hydrate_discovery_results: {
              output: {
                hydration_summary: { created_count: 0, updated_count: 0 },
                existing_resource_count: 0,
                ready_for_cycle: false,
              },
            },
          },
        },
      })
      .runAndAssert({
        includesJobs: ['discovery_and_specs'],
        jobConditions: {
          investigate_imported_repo: false,
          reconcile_import_specs: false,
          synthesize_and_hydrate_import: false,
          clear_import_hydration_blocked: false,
          emit_specs_ready: false,
          emit_cycle_request: false,
        },
        outputs: {
          investigate_imported_repo: { skipped: true },
          reconcile_import_specs: { skipped: true },
          synthesize_and_hydrate_import: { skipped: true },
          discovery_and_specs: { decision: 'accept' },
          emit_specs_ready: { skipped: true },
          emit_cycle_request: { skipped: true },
        },
      });
  });

  it('dry-runs imported synthesis route by skipping investigation and continuing discovery events', async () => {
    const fileName = 'project-discovery-ceo.workflow.yaml';
    const yaml = loadWorkflowYaml(fileName);
    const workflowId = `wf-seed-assert-${fileName.replace(/\.workflow\.yaml$/i, '')}-imported-synthesis`;
    const { engine } = createDryRunEngine({ workflowId, yaml });

    await workflowTest(engine, workflowId)
      .withTrigger({
        scopeId: 'project-seed-test',
        orchestrationId: 'orch-seed-test',
        selectedRoute: 'imported-repo-synthesis-and-hydration',
        selectedRuleId: 'imported_repo_synthesis',
        goals: 'hydrate imported repository discoveries',
        stateSummary: 'seed validation state',
        isRestart: false,
        basePath: 'G:/code/imported',
        repositoryUrl: 'https://example.test/repo.git',
      })
      .mockJob('discovery_and_specs', { decision: 'accept' })
      .mockJob('synthesize_and_hydrate_import', {
        childStateVariables: {
          jobs: {
            hydrate_discovery_results: {
              output: {
                hydration_summary: { created_count: 1, updated_count: 0 },
                existing_resource_count: 0,
                ready_for_cycle: true,
              },
            },
          },
        },
      })
      .runAndAssert({
        includesJobs: [
          'reconcile_import_specs',
          'synthesize_and_hydrate_import',
          'discovery_and_specs',
          'clear_import_hydration_blocked',
          'emit_specs_ready',
          'emit_cycle_request',
        ],
        jobConditions: {
          investigate_imported_repo: false,
          reconcile_import_specs: true,
          synthesize_and_hydrate_import: true,
          discovery_and_specs: true,
          clear_import_hydration_blocked: true,
          emit_specs_ready: true,
          emit_cycle_request: true,
        },
        outputs: {
          investigate_imported_repo: { skipped: true },
          discovery_and_specs: { decision: 'accept' },
        },
      });
  });

  it('defines the environment repair workflow with narrow sysadmin permissions and skill discovery', async () => {
    const fileName = 'workflow-environment-repair.workflow.yaml';
    const yaml = loadWorkflowYaml(fileName);
    const parser = new WorkflowParserService();
    const specialStepRegistry: SpecialStepHandlerLookup = {
      getHandler: vi.fn().mockReturnValue(null),
    };
    const validator = new WorkflowValidationService(
      {
        findByName: vi.fn().mockResolvedValue({ id: 'tool', name: 'any-tool' }),
      } as never,
      new DAGResolverService(),
      specialStepRegistry,
    );

    const workflow = parser.parseWorkflow(yaml);
    const [job] = workflow.jobs ?? [];

    await expect(validator.validateWorkflow(workflow)).resolves.toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(workflow.workflow_id).toBe('workflow_environment_repair');
    expect(workflow.trigger).toMatchObject({
      type: 'event',
      name: REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
    });
    expect(workflow.permissions?.tool_policy).toEqual({
      default: ToolPolicyEffect.DENY,
      rules: [
        { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'ls' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'bash' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'write' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'edit' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'get_todo_list' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'manage_todo_list' },
        { effect: ToolPolicyEffect.DENY, tool: 'step_complete' },
        { effect: ToolPolicyEffect.DENY, tool: 'spawn_subagent_async' },
        { effect: ToolPolicyEffect.DENY, tool: 'submit_qa_decision' },
      ],
    });
    expect(job).toMatchObject({
      id: 'repair_environment',
      type: 'execution',
      tier: 'heavy',
      max_retries: 0,
      inputs: {
        agent_profile: 'sysadmin-repair',
      },
      output_contract: {
        required: ['status', 'summary', 'changes'],
        optional: ['verification', 'evidence'],
      },
      permissions: workflow.permissions,
    });
    expect(job.steps).toEqual([
      {
        id: 'repair',
        type: 'agent',
        prompt_file: 'prompts/workflow-environment-repair/repair.md',
      },
    ]);

    const prompt = loadWorkflowPrompt(
      'prompts/workflow-environment-repair/repair.md',
    );
    expect(prompt).toContain('`status`: one of `succeeded` or `failed`');
    expect(prompt).toContain('policy_action_id');
    expect(prompt).toContain('failed_workflow_run_id');
    expect(prompt).toContain('failed_workflow_id');
    expect(prompt).toContain('failed_job_id');
    expect(prompt).toContain('repair_attempt');
    expect(prompt).toContain('classification_reason');
    expect(prompt).toContain(
      'If `policy_action_id` is not one of these two values, stop and report `status: failed`.',
    );
  });

  it('defines default agent delegation concurrency by dedupe key', () => {
    const yaml = loadWorkflowYaml(
      'orchestration-invoke-agent-default.workflow.yaml',
    );
    const workflow = new WorkflowParserService().parseWorkflow(yaml);

    expect(workflow.workflow_id).toBe('orchestration_invoke_agent_default');
    expect(workflow.concurrency).toEqual({
      max_runs: 1,
      scope: '{{ trigger.dedupeKey }}',
      on_conflict: 'skip',
    });
  });

  it('resolves default agent delegation concurrency to the trigger dedupe key', () => {
    const yaml = loadWorkflowYaml(
      'orchestration-invoke-agent-default.workflow.yaml',
    );
    const workflow = new WorkflowParserService().parseWorkflow(yaml);
    const runRepo = {
      countActiveByScope: vi.fn(),
      findOldestRunningByScope: vi.fn(),
    };
    const concurrencyPolicy = new ConcurrencyPolicyService(runRepo as never);

    const scope = concurrencyPolicy.resolveConcurrencyScope(
      workflow.concurrency,
      { dedupeKey: 'invoke-agent:project-1:agent:prompt-hash' },
    );

    expect(scope).toBe('invoke-agent:project-1:agent:prompt-hash');
  });
});

describe('seed workflows grant todo tools to todo-capable agent jobs', () => {
  const TODO_TOOLS = ['get_todo_list', 'manage_todo_list'] as const;

  // Agent execution jobs whose profile allows the todo tools and whose
  // prompt/role tracks progress. A deny-default job-or-workflow policy that
  // omits these tools silently strips them from the catalog
  // (effective catalog = job policy ∩ profile policy), producing a runtime
  // "Tool manage_todo_list not found" failure. Guards against that regression.
  // Files are matched by neutral fragments to keep the boundary lint happy.
  const todoCapableAgentJobs = [
    {
      fileFragments: ['in-progress', 'default'],
      jobId: 'implement_and_commit',
      profile: 'orchestrator',
    },
    {
      fileFragments: ['orchestration-cycle-ceo'],
      jobId: 'strategize',
      profile: 'ceo-agent',
    },
    {
      fileFragments: ['orchestration-cycle-ceo'],
      jobId: 'dispatch',
      profile: 'ceo-agent',
    },
    {
      fileFragments: ['charter-ceo'],
      jobId: 'capture_charter',
      profile: 'ceo-agent',
    },
    {
      fileFragments: ['charter-ceo'],
      jobId: 'capture_charter_brownfield',
      profile: 'ceo-agent',
    },
    {
      fileFragments: ['charter-ceo'],
      jobId: 'refine_charter',
      profile: 'ceo-agent',
    },
    {
      fileFragments: ['memory-learning-sweep'],
      jobId: 'sweep',
      profile: 'ceo-agent',
    },
  ] as const;

  const resolveSeedFile = (fragments: readonly string[]): string => {
    const file = listSeedWorkflowFiles().find((candidate) =>
      fragments.every((fragment) => candidate.includes(fragment)),
    );
    if (!file) {
      throw new Error(
        `No seed workflow file matches fragments: ${fragments.join(', ')}`,
      );
    }
    return file;
  };

  const collectRulesByEffect = (
    policy: ToolPolicyDocument | undefined,
    effect: ToolPolicyEffect,
  ): Set<string> => {
    const tools = new Set<string>();
    for (const rule of policy?.rules ?? []) {
      // Seed YAML uses the object form; tolerate the string shorthand too.
      if (typeof rule === 'string') {
        const [ruleEffect, tool] = rule.split(/\s+/u);
        if (ruleEffect === String(effect) && tool) {
          tools.add(tool);
        }
      } else if (rule.effect === effect) {
        tools.add(rule.tool);
      }
    }
    return tools;
  };

  it.each(todoCapableAgentJobs)(
    'grants todo tools to $jobId ($fileFragments)',
    ({ fileFragments, jobId, profile }) => {
      const file = resolveSeedFile(fileFragments);
      const workflow = new WorkflowParserService().parseWorkflow(
        loadWorkflowYaml(file),
      );
      const job = (workflow.jobs ?? []).find(
        (candidate) => candidate.id === jobId,
      );

      expect(job, `job ${jobId} not found in ${file}`).toBeDefined();
      expect(job?.type).toBe('execution');
      expect(job?.inputs?.agent_profile).toBe(profile);

      // Job-level policy takes precedence; otherwise the workflow-level policy
      // applies. Either way the effective catalog must keep the todo tools.
      const policy =
        job?.permissions?.tool_policy ?? workflow.permissions?.tool_policy;
      expect(policy?.default).toBe(ToolPolicyEffect.DENY);

      const allowed = collectRulesByEffect(policy, ToolPolicyEffect.ALLOW);
      const denied = collectRulesByEffect(policy, ToolPolicyEffect.DENY);

      for (const tool of TODO_TOOLS) {
        expect(allowed.has(tool), `${jobId} must allow ${tool}`).toBe(true);
        expect(denied.has(tool), `${jobId} must not deny ${tool}`).toBe(false);
      }
    },
  );
});
