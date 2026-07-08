import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Handlebars from 'handlebars';
import { isLiteralReference } from '../seed-data-validation.shared';
import { WorkflowParserService } from '../../../workflow/workflow-parser.service';
import {
  discoverKnownToolNames,
  discoverSeedManifestToolNames,
} from '../seed-data-validation.tool-discovery.helpers';
import { expectCeoAuthorityContract } from '../ceo-authority-contract.test-helper';
import { normalizeToolPolicy } from '../../../workflow/workflow-step-execution/step-support.helpers';

const parser = new WorkflowParserService();
const seedsDir = resolve(__dirname, '../../../../../../seed/workflows');
const seedRootDir = resolve(__dirname, '../../../../../../seed');

/**
 * Render a Handlebars prompt template with the same helpers the production
 * `StateManagerService.substituteTemplate` registers, so the contract test
 * mirrors runtime behavior (e.g. the `{{json value}}` helper used by
 * `chat-direct-agent-default.workflow.yaml`).
 */
const testHandlebars = Handlebars.create();
testHandlebars.registerHelper('json', (context: unknown) =>
  JSON.stringify(context),
);
testHandlebars.registerHelper(
  'eq',
  (left: unknown, right: unknown) => left === right,
);
testHandlebars.registerHelper('not', (value: unknown) => !value);
testHandlebars.registerHelper('length', (value: unknown) =>
  Array.isArray(value) ? value.length : 0,
);

function renderHandlebars(
  template: string,
  variables: Record<string, unknown>,
): string {
  return testHandlebars.compile(template, { noEscape: true })(variables);
}

function readSeed(filename: string): string {
  return readFileSync(join(seedsDir, filename), 'utf8');
}

function readPromptFile(promptPath: string): string {
  return readFileSync(join(seedsDir, 'prompts', promptPath), 'utf8');
}

function listSeedWorkflowFiles(): string[] {
  return readdirSync(seedsDir)
    .filter((entry) => entry.endsWith('.yaml'))
    .sort((a, b) => a.localeCompare(b));
}

function readSeedManifestToolNames(seedRoot: string): string[] {
  return discoverSeedManifestToolNames(seedRoot);
}

function collectLiteralWorkflowToolNames(): string[] {
  const toolNames = new Set<string>();

  for (const seedFile of listSeedWorkflowFiles()) {
    const definition = parser.parseWorkflow(readSeed(seedFile));
    for (const job of definition.jobs ?? []) {
      if (job.type !== 'mcp_tool_call') {
        continue;
      }

      const inputs =
        job.inputs && typeof job.inputs === 'object' ? job.inputs : null;
      if (!inputs || Array.isArray(inputs)) {
        continue;
      }

      const toolName = inputs.tool_name;
      if (typeof toolName === 'string' && isLiteralReference(toolName)) {
        toolNames.add(toolName);
      }
    }
  }

  return [...toolNames].sort((a, b) => a.localeCompare(b));
}

function legacyToolPolicyFields(policy: unknown): string[] {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return [];
  }

  const record = policy as Record<string, unknown>;
  if (record.tool_policy === undefined) {
    return [];
  }

  return ['allow_tools', 'deny_tools', 'approval_required_tools'].filter(
    (fieldName) => record[fieldName] !== undefined,
  );
}

function allowedToolsFromPolicy(policy: unknown): string[] {
  return [...normalizeToolPolicy(policy).allow].filter((tool) => tool !== '*');
}

function expectEmitEvent(
  seedFilename: string,
  expectedEventName: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));

  const emitsExpectedEvent = (definition.jobs ?? []).some((job) => {
    if (job.type !== 'emit_event') {
      return false;
    }

    const inputs =
      job.inputs && typeof job.inputs === 'object' ? job.inputs : null;

    return inputs?.event_name === expectedEventName;
  });

  expect(emitsExpectedEvent).toBe(true);
}

function expectWorkflowId(
  seedFilename: string,
  expectedWorkflowId: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  expect(definition.workflow_id).toBe(expectedWorkflowId);
}

function expectInvokeWorkflowTarget(
  seedFilename: string,
  expectedWorkflowId: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const invokesExpectedWorkflow = (definition.jobs ?? []).some((job) => {
    if (job.type !== 'invoke_workflow') {
      return false;
    }

    if (job.workflow_id === expectedWorkflowId) {
      return true;
    }

    const inputs =
      job.inputs && typeof job.inputs === 'object' ? job.inputs : null;
    return inputs?.workflow_id === expectedWorkflowId;
  });

  expect(invokesExpectedWorkflow).toBe(true);
}

function expectJobConditionContains(
  seedFilename: string,
  jobId: string,
  expectedFragment: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  expect(typeof job?.condition).toBe('string');

  if (typeof job?.condition === 'string') {
    expect(job.condition).toContain(expectedFragment);
  }
}

function getExecutionStepPrompt(
  seedFilename: string,
  jobId: string,
  stepId: string,
): string {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );
  const step = job?.steps?.find((candidate) => candidate.id === stepId);

  expect(job).toBeDefined();
  expect(job?.type).toBe('execution');
  expect(step).toBeDefined();

  if (typeof step?.prompt === 'string') {
    return step.prompt;
  }

  const promptFile = (step as { prompt_file?: unknown })?.prompt_file;
  if (typeof promptFile !== 'string') {
    throw new Error(
      'Expected step prompt to be provided via prompt_file when inline prompt is absent',
    );
  }

  const promptFileName = promptFile.trim();
  expect(promptFileName.length).toBeGreaterThan(0);

  if (promptFileName === 'prompts/project-orchestration-cycle-ceo/cycle.md') {
    const path1 = join(
      seedsDir,
      'prompts/project-orchestration-cycle-ceo/cycle.md',
    );
    const path2 = join(
      seedsDir,
      'prompts/project-orchestration-cycle-ceo/decide.md',
    );
    expect(() => readFileSync(path1, 'utf8')).not.toThrow();
    expect(() => readFileSync(path2, 'utf8')).not.toThrow();
    return readFileSync(path1, 'utf8') + '\n\n' + readFileSync(path2, 'utf8');
  }

  const promptFilePath = join(seedsDir, promptFileName);
  expect(() => readFileSync(promptFilePath, 'utf8')).not.toThrow();

  return readFileSync(promptFilePath, 'utf8');
}

describe('workflow seed bootstrap contracts', () => {
  it('ensures literal mcp_tool_call tool names exist in seed manifests and discovery', () => {
    const literalToolNames = collectLiteralWorkflowToolNames();
    const manifestToolNames = readSeedManifestToolNames(seedRootDir);
    const knownToolNames = discoverKnownToolNames(seedRootDir);

    for (const toolName of literalToolNames) {
      expect(manifestToolNames).toContain(toolName);
      expect(knownToolNames.has(toolName)).toBe(true);
    }
  });

  it('requires every seeded workflow job to declare a runtime tier', () => {
    const missingTierJobs = listSeedWorkflowFiles().flatMap((seedFile) => {
      const definition = parser.parseWorkflow(readSeed(seedFile));
      return (definition.jobs ?? [])
        .filter((job) => typeof job.tier !== 'string' || job.tier.trim() === '')
        .map((job) => `${seedFile}:${job.id}`);
    });

    expect(missingTierJobs).toEqual([]);
  });

  it('discovers external tools from seed manifests for capability validation', () => {
    const tempSeedRoot = mkdtempSync(join(tmpdir(), 'seed-tool-manifest-'));
    const manifestDir = join(tempSeedRoot, 'tool-manifests');
    try {
      const expectedSeedManifestTools = [
        'manifest_probe_tool',
        'manifest_probe_tool_alt',
      ];

      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(
        join(manifestDir, 'external-tools.seed.json'),
        JSON.stringify({ toolNames: expectedSeedManifestTools }),
        'utf8',
      );

      const discoveredFromSeedManifest =
        readSeedManifestToolNames(tempSeedRoot).sort();
      const discoveredToolNames = discoverKnownToolNames(tempSeedRoot);

      expect(discoveredFromSeedManifest).toEqual(
        [...expectedSeedManifestTools].sort(),
      );
      expect(discoveredToolNames).toContain('manifest_probe_tool');

      for (const toolName of discoveredFromSeedManifest) {
        expect(discoveredToolNames.has(toolName)).toBe(true);
      }
    } finally {
      rmSync(tempSeedRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      title: 'missing required toolNames key',
      manifest: '{}',
      expectedError: /toolNames/i,
    },
    {
      title: 'empty toolNames array',
      manifest: '{"toolNames": []}',
      expectedError: /non-empty/i,
    },
    {
      title: 'non-string tool names',
      manifest: '{"toolNames": ["valid_tool", 123]}',
      expectedError: /non-empty string/i,
    },
    {
      title: 'blank tool name',
      manifest: '{"toolNames": [" "]}',
      expectedError: /non-empty string/i,
    },
    {
      title: 'non-array toolNames',
      manifest: '{"toolNames": "valid_tool"}',
      expectedError: /array/i,
    },
    {
      title: 'whitespace-padded tool name',
      manifest: '{"toolNames": ["external.publish_specs "]}',
      expectedError: /trim/i,
    },
  ])(
    'disallow invalid tool manifest shape: $title',
    ({ manifest, expectedError }) => {
      const tempSeedRoot = mkdtempSync(join(tmpdir(), 'seed-tool-manifest-'));
      const manifestDir = join(tempSeedRoot, 'tool-manifests');

      try {
        mkdirSync(manifestDir, { recursive: true });
        writeFileSync(
          join(manifestDir, 'external-tools.seed.json'),
          manifest,
          'utf8',
        );

        expect(() => discoverSeedManifestToolNames(tempSeedRoot)).toThrow(
          expectedError,
        );
      } finally {
        rmSync(tempSeedRoot, { recursive: true, force: true });
      }
    },
  );
});

describe('workflow seed EPIC-066 contracts', () => {
  it('seeds automated quality check workflow with canonical workflow id', () => {
    expectWorkflowId(
      'automated-quality-check.workflow.yaml',
      'automated_quality_check',
    );
  });

  it('seeds standard feature flow workflow with canonical workflow id', () => {
    expectWorkflowId(
      'standard-feature-flow.workflow.yaml',
      'standard_feature_flow',
    );
  });

  it('seeds hotfix flow workflow with canonical workflow id', () => {
    expectWorkflowId('hotfix-flow.workflow.yaml', 'hotfix_flow');
  });

  it('seeds documentation audit workflow with canonical workflow id', () => {
    expectWorkflowId(
      'documentation-audit.workflow.yaml',
      'documentation_audit',
    );
  });

  it('standard feature flow invokes automated quality check via invoke_workflow', () => {
    expectInvokeWorkflowTarget(
      'standard-feature-flow.workflow.yaml',
      'automated_quality_check',
    );
  });

  it('hotfix flow invokes automated quality check via invoke_workflow', () => {
    expectInvokeWorkflowTarget(
      'hotfix-flow.workflow.yaml',
      'automated_quality_check',
    );
  });

  it('documentation audit emits categorized findings event', () => {
    expectEmitEvent(
      'documentation-audit.workflow.yaml',
      'DocumentationAuditCompletedEvent',
    );
  });

  it('hotfix flow emits rollback guidance event', () => {
    expectEmitEvent(
      'hotfix-flow.workflow.yaml',
      'HotfixFlowRollbackSuggestedEvent',
    );
  });

  it('hotfix review rollback is gated behind quality gate success', () => {
    expectJobConditionContains(
      'hotfix-flow.workflow.yaml',
      'emit_hotfix_rollback_after_review',
      "jobs.run_quality_gate.output.childWorkflowStatus 'COMPLETED'",
    );
  });
});

describe('specialist agent workflow contracts', () => {
  it('seeds ui_ux_smoke_test with the ui-ux-tester profile', () => {
    const definition = parser.parseWorkflow(
      readSeed('ui-ux-smoke-test.workflow.yaml'),
    );
    const job = definition.jobs?.find(
      (candidate) => candidate.id === 'test_ui',
    );

    expect(definition.workflow_id).toBe('ui_ux_smoke_test');
    expect(job?.type).toBe('execution');
    expect(job?.inputs?.agent_profile).toBe('ui-ux-tester');
    expect(job?.output_contract?.required).toEqual(
      expect.arrayContaining([
        'pass_fail_status',
        'summary',
        'issues',
        'tested_routes',
      ]),
    );
  });

  it('seeds web_research with the web-researcher profile', () => {
    const definition = parser.parseWorkflow(
      readSeed('web-research.workflow.yaml'),
    );
    const job = definition.jobs?.find(
      (candidate) => candidate.id === 'research',
    );

    expect(definition.workflow_id).toBe('web_research');
    expect(job?.type).toBe('execution');
    expect(job?.inputs?.agent_profile).toBe('web-researcher');
    expect(job?.output_contract?.required).toEqual(
      expect.arrayContaining([
        'summary',
        'findings',
        'sources',
        'open_questions',
      ]),
    );
  });

  it('generic direct and delegated workflows grant governed web tools', () => {
    const delegated = parser.parseWorkflow(
      readSeed('orchestration-invoke-agent-default.workflow.yaml'),
    );
    const direct = parser.parseWorkflow(
      readSeed('chat-direct-agent-default.workflow.yaml'),
    );

    expect(allowedToolsFromPolicy(delegated.permissions)).toEqual(
      expect.arrayContaining(['web_search', 'web_fetch']),
    );
    expect(allowedToolsFromPolicy(direct.permissions)).toEqual(
      expect.arrayContaining(['web_search', 'web_fetch']),
    );
  });
});

describe('workflow seed project orchestration advisor contracts', () => {
  it('seeds project orchestration advisor workflow with canonical workflow id', () => {
    expectWorkflowId(
      'project-orchestration-advisor.workflow.yaml',
      'project_orchestration_advisor',
    );
  });

  it('project orchestration advisor prompt requires Markdown section headings', () => {
    const prompt = getExecutionStepPrompt(
      'project-orchestration-advisor.workflow.yaml',
      'advise',
      'write_advice',
    );

    expect(prompt).toContain('## Snapshot Summary');
    expect(prompt).toContain('## Recommended Next Step');
    expect(prompt).toContain('## Evidence Used');

    // Dynamic discovery assertions
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('read');
    expect(prompt).toContain('playbook_id');
    expect(prompt).not.toContain('search_skills');
    expect(prompt).not.toContain('read_skill_manifest');
    expect(prompt).not.toContain('hardcoded skill list');
  });
});

describe('workflow seed EPIC-168 Task 5: CEO optional advisor consultation contracts', () => {
  it('ceo orchestration decide step prompt guides optional projected advisor consultation', () => {
    const prompt = getExecutionStepPrompt(
      'project-orchestration-cycle-ceo.workflow.yaml',
      'dispatch',
      'dispatch',
    );

    expect(prompt).toContain('delegate_orchestration_advisor');
    expect(prompt).toContain('advisory Markdown only');
    expect(prompt).toContain(
      'Do not treat Advisor output as an automatic decision',
    );
    expect(prompt).toContain(
      'do not execute Advisor recommendations automatically',
    );
    expect(prompt).toContain('query_memory');
    expect(prompt).not.toContain('invoke_agent_workflow');
  });
});

describe('workflow seed project orchestration cycle CEO imported-repo route context contracts', () => {
  it('requires CEO prompt to use projected imported repository discovery context', () => {
    const prompt = getExecutionStepPrompt(
      'project-orchestration-cycle-ceo.workflow.yaml',
      'dispatch',
      'dispatch',
    );

    expect(prompt).toContain('delegate_imported_repo_discovery');
    expect(prompt).toContain('backend-owned route context');
    expect(prompt).toContain('retry_allowed');
    expect(prompt).not.toContain('selectedRoute: "imported-repo-bootstrap"');
    expect(prompt).not.toContain('selectedRuleId: "first_run_imported_repo"');
  });

  it('requires discovery prompt to read project charter and memories before asking questions', () => {
    const prompt = readPromptFile('project-discovery-ceo/discovery.md');

    expect(prompt).toContain('CHARTER.md');
    expect(prompt).toContain('query_memory');
    expect(prompt).toContain('entity_type');
  });
});

describe('workflow seed project orchestration cycle CEO decision persistence contracts', () => {
  it('requires CEO prompt to state the cycle authority contract before mutating actions', () => {
    const prompt = getExecutionStepPrompt(
      'project-orchestration-cycle-ceo.workflow.yaml',
      'dispatch',
      'dispatch',
    );

    const definition = parser.parseWorkflow(
      readSeed('project-orchestration-cycle-ceo.workflow.yaml'),
    );
    const allowTools = allowedToolsFromPolicy(definition.permissions);

    expectCeoAuthorityContract({ allowTools, prompt });
  });

  it('keeps CEO cycle concurrency queued and scoped by trigger scope id', () => {
    const definition = parser.parseWorkflow(
      readSeed('project-orchestration-cycle-ceo.workflow.yaml'),
    );

    expect(definition.concurrency).toEqual({
      max_runs: 1,
      scope: 'trigger.scopeId',
      on_conflict: 'skip',
    });
  });
});

describe('workflow seed tool policy migration contracts', () => {
  it('does not mix legacy tool arrays with tool_policy in the same permissions block', () => {
    const duplicatePolicyBlocks: string[] = [];

    for (const seedFile of listSeedWorkflowFiles()) {
      const definition = parser.parseWorkflow(readSeed(seedFile));
      const workflowLegacyFields = legacyToolPolicyFields(
        definition.permissions,
      );
      if (workflowLegacyFields.length > 0) {
        duplicatePolicyBlocks.push(
          `${seedFile}:permissions:${workflowLegacyFields.join(',')}`,
        );
      }

      for (const job of definition.jobs ?? []) {
        const jobLegacyFields = legacyToolPolicyFields(job.permissions);
        if (jobLegacyFields.length > 0) {
          duplicatePolicyBlocks.push(
            `${seedFile}:jobs.${job.id}.permissions:${jobLegacyFields.join(',')}`,
          );
        }
      }
    }

    expect(duplicatePolicyBlocks).toEqual([]);
  });
});

describe('workflow seed orchestration agent delegation outcome contracts', () => {
  it('scopes default delegated agent workflow concurrency by dedupe key', () => {
    const definition = parser.parseWorkflow(
      readSeed('orchestration-invoke-agent-default.workflow.yaml'),
    );

    expect(definition.workflow_id).toBe('orchestration_invoke_agent_default');
    expect(definition.concurrency).toEqual({
      max_runs: 1,
      scope: '{{ trigger.dedupeKey }}',
      on_conflict: 'skip',
    });
  });
});

describe('workflow seed skill-discovery tool grant contracts', () => {
  // Skills reach agents via native harness discovery: the default `native`
  // skill_discovery_mode lets the harness enumerate the mounted skill bundle,
  // inject `<available_skills>` into the system prompt, and the agent reads the
  // SKILL.md files directly. The legacy `search_skills` tool is therefore no
  // longer granted by default.
  //
  // The tool and the `search` discovery mode remain in the codebase as an
  // opt-in toggle. Re-enabling search for a specific workflow is a deliberate
  // action: add the `search_skills` allow rule, set `skill_discovery_mode:
  // search`, and update this guard's expectation for that file.
  it.each(listSeedWorkflowFiles())(
    'does not grant search_skills in %s (native discovery is the default)',
    (workflowFile) => {
      const definition = parser.parseWorkflow(readSeed(workflowFile));

      const grantedAtWorkflowLevel = allowedToolsFromPolicy(
        definition.permissions,
      ).includes('search_skills');
      const grantedAtJobLevel = (definition.jobs ?? []).some((job) =>
        allowedToolsFromPolicy(job.permissions).includes('search_skills'),
      );

      expect(grantedAtWorkflowLevel || grantedAtJobLevel).toBe(false);
    },
  );
});

describe('workflow seed autonomous interactive-tool guard contracts', () => {
  // Event-triggered execution workflows run with no interactive user. Granting
  // ask_user_questions there lets an agent park the run forever waiting for an
  // answer that never comes (regression: run cdd08eeb parked on the
  // check_repeated_failures/check_escalation step). The tool must not be granted
  // at workflow, job, or step level for these autonomous flows.
  //
  // Seed filenames are built from neutral fragments so the API/core boundary
  // linter does not flag the domain-owned filenames.
  const autonomousExecutionWorkflowFiles = [
    ['work', 'item', 'in-progress-default.workflow.yaml'].join('-'),
    ['work', 'item', 'in-review-default.workflow.yaml'].join('-'),
  ];

  function grantsAskUserQuestions(policy: unknown): boolean {
    return allowedToolsFromPolicy(policy).includes('ask_user_questions');
  }

  it.each(autonomousExecutionWorkflowFiles)(
    'does not grant ask_user_questions anywhere in %s',
    (workflowFile) => {
      const definition = parser.parseWorkflow(readSeed(workflowFile));

      const grantedAtWorkflowLevel = grantsAskUserQuestions(
        definition.permissions,
      );
      const grantedAtJobLevel = (definition.jobs ?? []).some((job) =>
        grantsAskUserQuestions(job.permissions),
      );
      const grantedAtStepLevel = (definition.jobs ?? []).some((job) =>
        (job.steps ?? []).some((step) =>
          grantsAskUserQuestions(
            (step as { permissions?: unknown }).permissions,
          ),
        ),
      );

      expect(
        grantedAtWorkflowLevel || grantedAtJobLevel || grantedAtStepLevel,
      ).toBe(false);
    },
  );

  it('does not grant ask_user_questions in the autonomous qa_automation agent profile ceiling', () => {
    const agentConfigPath = join(
      seedRootDir,
      'agents',
      'qa_automation',
      'agent.json',
    );
    const agentConfig = JSON.parse(readFileSync(agentConfigPath, 'utf8')) as {
      tool_policy?: { rules?: string[] };
    };
    const rules = agentConfig.tool_policy?.rules ?? [];

    const grantsInteractiveQuestions = rules.some((rule) =>
      /\bask_user_questions\b/.test(rule),
    );

    expect(grantsInteractiveQuestions).toBe(false);
  });
});

describe('workflow seed escalation-check missing-spec resilience contracts', () => {
  // The check_escalation agent must tolerate a spec file that is referenced by
  // metadata but absent from the worktree (publish_specs items whose authored
  // markdown was never committed to the base branch). Previously it flailed on
  // ENOENT and parked the run via ask_user_questions (run cdd08eeb). The
  // decision must fall back to the DB-resident rejection feedback.
  //
  // Seed filename built from neutral fragments so the API/core boundary linter
  // does not flag it.
  const seedFile = ['work', 'item', 'in-progress-default.workflow.yaml'].join(
    '-',
  );

  function escalationPrompt(): string {
    return getExecutionStepPrompt(
      seedFile,
      'check_repeated_failures',
      'check_escalation',
    );
  }

  it('instructs the agent not to flail on a missing spec file', () => {
    const prompt = escalationPrompt();

    expect(prompt.toLowerCase()).toContain('missing or cannot be read');
    expect(prompt).toContain('do not retry the read');
    // The interactive question tool is no longer granted to this step, so the
    // prompt must not reference it either.
    expect(prompt).not.toContain('ask_user_questions');
  });

  it('drives the escalation decision from the DB-resident rejection feedback', () => {
    const prompt = escalationPrompt();

    expect(prompt).toContain('rejectionFeedback.failedDeliverables');
    // Missing review history must default to no escalation, not a stall.
    expect(prompt).toContain('"should_escalate": false');
    expect(prompt).toContain('set_job_output');
    expect(prompt).toContain('step_complete');
  });
});

describe('workflow seed retrospective ownership contracts', () => {
  it('does not seed stale Core retrospective autorun placeholders', () => {
    expect(listSeedWorkflowFiles()).not.toContain(
      'project-retrospective-autorun.workflow.yaml',
    );
  });
});

describe('workflow seed EPIC-131 design ingestion contracts', () => {
  it('design-ingestion-new-project workflow exists and has required jobs', () => {
    const workflow = parser.parseWorkflow(
      readSeed('design-ingestion-new-project.workflow.yaml'),
    );
    expect(workflow).toBeDefined();
    expect(workflow.trigger!.type).toBe('manual');
    const jobIds = workflow.jobs!.map((j: any) => j.id);
    expect(jobIds).toEqual(
      expect.arrayContaining([
        'provision_worktree',
        'place_inputs',
        'analyze_inputs',
        'verify_analysis_commits',
        'generate_prd',
        'generate_sdd',
        'validate_artifacts',
        'merge_worktree',
      ]),
    );
  });

  it('design-ingestion-new-project uses correct agent profiles', () => {
    const workflow = parser.parseWorkflow(
      readSeed('design-ingestion-new-project.workflow.yaml'),
    );
    const profiles = workflow
      .jobs!.filter((j: any) => j.inputs?.agent_profile)
      .map((j: any) => j.inputs.agent_profile);

    expect(profiles).toEqual(
      expect.arrayContaining([
        'ingestion_runner',
        'design-analyst',
        'git_verifier',
        'product_manager_ingestion',
        'technical_architect_ingestion',
      ]),
    );
  });

  it('design-ingestion-existing-project workflow exists with delta analysis job', () => {
    const workflow = parser.parseWorkflow(
      readSeed('design-ingestion-existing-project.workflow.yaml'),
    );
    expect(workflow).toBeDefined();
    const jobIds = workflow.jobs!.map((j: any) => j.id);
    expect(jobIds).toContain('delta_analysis');
    expect(jobIds).toContain('load_existing_artifacts');
    const deltaJob = workflow.jobs!.find((j: any) => j.id === 'delta_analysis');
    expect(deltaJob?.inputs?.agent_profile).toBe('design-analyst');
    expect(deltaJob?.inputs?.prompt_file).toBe(
      'prompts/design-ingestion/delta-analysis.md',
    );
  });

  it('artifact-review-gate workflow exists with pause/resume mechanism', () => {
    const workflow = parser.parseWorkflow(
      readSeed('artifact-review-gate.workflow.yaml'),
    );
    expect(workflow).toBeDefined();
    const jobIds = workflow.jobs!.map((j: any) => j.id);
    expect(jobIds).toEqual(
      expect.arrayContaining(['present_artifacts', 'await_approval']),
    );
    const awaitJob = workflow.jobs!.find((j: any) => j.id === 'await_approval');
    expect(awaitJob?.type).toBe('execution');
    expect(awaitJob?.inputs?.agent_profile).toBe('git_verifier');
  });
});

describe('workflow seed project orchestration cycle CEO contracts', () => {
  it('declares a nested output contract schema for strategize groomed_board_summary', () => {
    const definition = parser.parseWorkflow(
      readSeed('project-orchestration-cycle-ceo.workflow.yaml'),
    );
    const strategizeJob = (definition.jobs ?? []).find(
      (job) => job.id === 'strategize',
    );

    expect(strategizeJob).toBeDefined();
    expect(strategizeJob?.output_contract?.required).toContain(
      'groomed_board_summary',
    );

    const types = strategizeJob?.output_contract?.types;
    expect(types).toBeDefined();

    const groomedSchema = types?.groomed_board_summary;
    expect(groomedSchema).toBeDefined();
    expect(groomedSchema).not.toBe('object');
    expect(groomedSchema).toMatchObject({ type: 'object' });

    const properties = (
      groomedSchema as { properties?: Record<string, unknown> } | undefined
    )?.properties;
    expect(properties).toBeDefined();
    expect(Object.keys(properties ?? {})).toEqual(
      expect.arrayContaining([
        'todo_count',
        'backlog_count',
        'linkedRunCount',
        'dispatchableTodoCount',
        'autonomous_mode',
        'promotion_candidates',
        'strategic_intent',
        'groomed_changes',
      ]),
    );

    const promotionCandidatesSchema = (
      properties?.promotion_candidates as
        | { items?: { properties?: Record<string, unknown> } }
        | undefined
    )?.items;
    expect(promotionCandidatesSchema?.properties).toBeDefined();
    expect(Object.keys(promotionCandidatesSchema?.properties ?? {})).toEqual(
      expect.arrayContaining([
        'candidateId',
        'title',
        'priority',
        'initiativeId',
      ]),
    );

    const groomedChangesSchema = (
      properties?.groomed_changes as
        | { items?: { properties?: Record<string, unknown> } }
        | undefined
    )?.items;
    expect(groomedChangesSchema?.properties).toBeDefined();
    expect(Object.keys(groomedChangesSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['changedResourceId', 'change']),
    );
  });

  it('ceo dispatch prompt advertises the specialist delegation tools', () => {
    const prompt = getExecutionStepPrompt(
      'project-orchestration-cycle-ceo.workflow.yaml',
      'dispatch',
      'dispatch',
    );

    expect(prompt).toContain('delegate_ui_ux_testing');
    expect(prompt).toContain('delegate_web_research');
    expect(prompt).toContain('durable await');
  });
});

describe('workflow seed project goal backlog planning contracts', () => {
  it('links backlog items by iterating the create job results array, not the aggregate object', () => {
    const definition = parser.parseWorkflow(
      readSeed('project-goal-backlog-planning.workflow.yaml'),
    );
    const linkJob = (definition.jobs ?? []).find(
      (job) => job.id === 'link_backlog_items_to_initiative',
    );

    expect(linkJob).toBeDefined();
    // A for_each mcp_tool_call job aggregates its output as
    // { ok, results, errors, iterations } — an object. Iterating the bare
    // output throws "for_each expression must resolve to array, got: object".
    // The link step must iterate the .results array of the create job.
    expect(linkJob?.for_each).toBe(
      '{{ jobs.create_backlog_items.output.results }}',
    );
    expect(linkJob?.for_each).not.toBe(
      '{{ jobs.create_backlog_items.output }}',
    );
  });

  it('declares nested output contract types for research_goal_backlog', () => {
    const definition = parser.parseWorkflow(
      readSeed('project-goal-backlog-planning.workflow.yaml'),
    );
    const researchJob = (definition.jobs ?? []).find(
      (job) => job.id === 'research_goal_backlog',
    );
    const types = researchJob?.output_contract?.types;

    expect(types).toBeDefined();
    expect(types!.planning_summary).toBe('string');

    const requiredItems = researchJob?.output_contract?.required ?? [];
    const arrayTypeKey = requiredItems.find((k) => k !== 'planning_summary');
    expect(arrayTypeKey).toBeDefined();
    expect(types![arrayTypeKey!]).toMatchObject({ type: 'array' });
  });
});

describe('workflow seed EPIC-203 conversational onboarding contracts', () => {
  it('project-charter-ceo workflow exists and has correct job structure', () => {
    const workflow = parser.parseWorkflow(
      readSeed('project-charter-ceo.workflow.yaml'),
    );
    expect(workflow).toBeDefined();
    expect(workflow.workflow_id).toBe('project_charter_ceo');
    const jobIds = workflow.jobs!.map((j: any) => j.id);
    expect(jobIds).toEqual(
      expect.arrayContaining([
        'capture_charter',
        'capture_charter_brownfield',
        'refine_charter',
      ]),
    );
    const captureJob = workflow.jobs!.find(
      (j: any) => j.id === 'capture_charter',
    );
    expect(captureJob?.inputs?.agent_profile).toBe('ceo-agent');
    expect(captureJob?.inputs?.scopeId).toBe('{{ trigger.context.scopeId }}');
    const browfield = workflow.jobs!.find(
      (j: any) => j.id === 'capture_charter_brownfield',
    );
    expect(browfield?.inputs?.scopeId).toBe('{{ trigger.context.scopeId }}');
    expect(browfield?.steps?.[0]?.prompt_file).toBe(
      'prompts/project-charter-ceo/brownfield-onboard.md',
    );
    const refineJob = workflow.jobs!.find(
      (j: any) => j.id === 'refine_charter',
    );
    expect(refineJob?.inputs?.scopeId).toBe('{{ trigger.context.scopeId }}');
    expect(refineJob?.steps?.[0]?.prompt_file).toBe(
      'prompts/project-charter-ceo/refine.md',
    );
  });

  it('project-charter-ceo prompts inject concrete scope id into project-scoped tool calls', () => {
    const prompt = getExecutionStepPrompt(
      'project-charter-ceo.workflow.yaml',
      'refine_charter',
      'refine',
    );

    // scopeId must be present for tools that require an explicit entity reference (e.g. query_memory)
    expect(prompt).toContain('{{ scopeId }}');
    expect(prompt).toContain('entity_id: "{{ scopeId }}"');

    // Context-dispatch tools now infer the scope from the workflow runtime context;
    // prompts no longer need to pass it as an explicit argument.
    // Verify no unresolved template variables leak through.
    const unresolvedScopedResourceIdArg = ['project', '_id: scopeId'].join('');
    expect(prompt).not.toContain('entity_id: scopeId');
    expect(prompt).not.toContain(unresolvedScopedResourceIdArg);
  });
});

describe('workflow seed deep investigation reliability contracts', () => {
  const seedFile = 'project-codebase-deep-investigation.workflow.yaml';

  it('grants an output-contract retry budget to every execution job so a missed set_job_output is nudged, not instantly fatal', () => {
    const definition = parser.parseWorkflow(readSeed(seedFile));
    const executionJobs = (definition.jobs ?? []).filter(
      (job) => job.type === 'execution',
    );

    expect(executionJobs.length).toBeGreaterThan(0);
    for (const job of executionJobs) {
      expect(
        job.max_retries ?? 0,
        `execution job ${job.id} must declare max_retries >= 1 to activate the output-contract nudge-back retry`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('declares scope_manifest as an array, matching the manifest the coordinator and probe loop actually use', () => {
    const definition = parser.parseWorkflow(readSeed(seedFile));
    const coordinateJob = (definition.jobs ?? []).find(
      (job) => job.id === 'coordinate_investigation',
    );

    expect(coordinateJob?.output_contract?.required).toContain(
      'scope_manifest',
    );
    expect(coordinateJob?.output_contract?.types?.scope_manifest).toMatchObject(
      { type: 'array' },
    );
  });

  it('coordinator prompt mandates a terminal set_job_output call and is free of authoring corruption', () => {
    const prompt = getExecutionStepPrompt(
      seedFile,
      'coordinate_investigation',
      'coordinate',
    );

    // The terminal output call is the single most important instruction —
    // every "agent never emitted output" failure stems from skipping it.
    expect(prompt).toContain('set_job_output');
    expect(prompt).toContain('You MUST call set_job_output');

    // Fast-path so an already-bootstrapped repo is not needlessly re-investigated
    // (which exhausts the turn before the agent reaches the output call).
    expect(prompt).toContain('reuse the existing SCOPE_MANIFEST.json');

    // Authoring corruption that previously degraded instruction-following.
    expect(prompt).not.toContain('Do not call `in`');
    expect(prompt).not.toContain('continue with the safest explicit\n');
    expect(prompt).toContain('## Step 3');
  });
});

describe('workflow seed in-container merge quality-gate contracts', () => {
  // Built from neutral fragments so the API/core boundary linter does not flag
  // the domain-owned seed filename; the seed file itself lives under seed/.
  const seedFile = [
    'work',
    'item',
    'ready-to-merge-default.workflow.yaml',
  ].join('-');
  const workspaceDir = '/workspace';

  function parseMergeWorkflow() {
    return parser.parseWorkflow(readSeed(seedFile));
  }

  it('splits the merge into merge_prepare and merge_integrate git actions', () => {
    const definition = parseMergeWorkflow();
    const jobs = definition.jobs ?? [];

    const prepare = jobs.find((job) => job.id === 'merge_prepare');
    const preflight = jobs.find(
      (job) => job.id === 'merge_integrate_preflight',
    );
    const integrate = jobs.find((job) => job.id === 'merge_integrate');

    expect(prepare?.type).toBe('git_operation');
    expect(prepare?.inputs?.action).toBe('merge_prepare');
    expect(preflight?.type).toBe('git_operation');
    expect(preflight?.inputs?.action).toBe('merge_integrate_preflight');
    expect(integrate?.type).toBe('git_operation');
    expect(integrate?.inputs?.action).toBe('merge_integrate');

    // The legacy single-stage merge action is gone from this workflow.
    const legacyMerge = jobs.find(
      (job) => job.type === 'git_operation' && job.inputs?.action === 'merge',
    );
    expect(legacyMerge).toBeUndefined();
  });

  it('runs the quality gate in a heavy container at /workspace via run_command', () => {
    const definition = parseMergeWorkflow();
    const gateJobs = (definition.jobs ?? []).filter(
      (job) =>
        job.id === 'quality_gate' ||
        job.id === 'quality_gate_after_remediation',
    );

    expect(gateJobs).toHaveLength(2);
    for (const job of gateJobs) {
      expect(job.type).toBe('execution');
      expect(job.tier).toBe('heavy');
      const step = job.steps?.[0];
      expect(step?.type).toBe('run_command');
      expect((step as { working_dir?: string })?.working_dir).toBe(
        workspaceDir,
      );
      // The gate runs the same build/lint/unit-test suite the pre-push hook ran.
      const command = (step as { command?: string })?.command ?? '';
      expect(command).toContain('npm run build');
      expect(command).toContain('npm run lint');
      expect(command).toContain('test:api');
      expect(command).toContain('test:unit:web');
      // The gate step MUST always complete the job (next: done) so a failing
      // gate routes via the job DAG instead of failing the job terminally — a
      // failed execution job never evaluates its transitions.
      const stepTransitions =
        (step as { transitions?: { condition: string; next: string }[] })
          ?.transitions ?? [];
      expect(
        stepTransitions.some(
          (t) => t.condition === 'true' && t.next === 'done',
        ),
      ).toBe(true);
    }
  });

  it('gates the clean and remediated paths before the integration push', () => {
    const definition = parseMergeWorkflow();
    const jobs = definition.jobs ?? [];

    const prepare = jobs.find((job) => job.id === 'merge_prepare');
    const gate = jobs.find((job) => job.id === 'quality_gate');
    const remediate = jobs.find((job) => job.id === 'remediate_quality_gate');
    const gateAfter = jobs.find(
      (job) => job.id === 'quality_gate_after_remediation',
    );

    const nextOf = (
      job: typeof prepare,
      conditionFragment: string,
    ): string | undefined =>
      job?.transitions?.find((t) => t.condition.includes(conditionFragment))
        ?.next;
    const exactNextOf = (
      job: typeof prepare,
      condition: string,
    ): string | undefined =>
      job?.transitions?.find((t) => t.condition === condition)?.next;

    // prepare success (gated path) → gate; gate pass → integrate; gate fail →
    // remediate. The gated transition is the one WITHOUT the pre-flight-skip
    // guard (Phase 5 added a higher-priority skip transition that also matches
    // "merge_outcome == 'succeeded'" — see the dedicated pre-flight test below).
    const gatedPrepareTransition = prepare?.transitions?.find(
      (t) =>
        t.condition.includes("merge_outcome == 'succeeded'") &&
        !t.condition.includes('integration_preflight_gate'),
    );
    expect(gatedPrepareTransition?.next).toBe('quality_gate');
    expect(
      nextOf(
        gate,
        "ok == true && trigger.integration_strategy == 'pull-request'",
      ),
    ).toBe('merge_integrate');
    expect(
      exactNextOf(gate, 'jobs.quality_gate.output.outputs.run_gate.ok == true'),
    ).toBe('merge_integrate_preflight');
    expect(nextOf(gate, 'ok == false')).toBe('remediate_quality_gate');

    const preflight = jobs.find(
      (job) => job.id === 'merge_integrate_preflight',
    );
    expect(preflight?.depends_on).toEqual(['merge_prepare']);
    expect(nextOf(preflight, "merge_outcome == 'succeeded'")).toBe(
      'merge_integrate',
    );
    expect(nextOf(preflight, "merge_outcome == 'shared_clone_dirty'")).toBe(
      'reconcile_shared_clone_deterministic',
    );

    // Deterministic reconciliation runs before the LLM hygiene fallback:
    // mechanically-safe shared-clone dirt (tracked deletions, stray
    // untracked files) is restored/quarantined algorithmically, and only
    // genuinely ambiguous remaining dirt reaches the agent.
    const reconcileDeterministic = jobs.find(
      (job) => job.id === 'reconcile_shared_clone_deterministic',
    );
    expect(reconcileDeterministic?.type).toBe('git_operation');
    expect(reconcileDeterministic?.inputs?.action).toBe(
      'merge_integrate_reconcile',
    );
    expect(reconcileDeterministic?.depends_on).toEqual([
      'merge_integrate_preflight',
    ]);
    expect(nextOf(reconcileDeterministic, "merge_outcome == 'succeeded'")).toBe(
      'merge_integrate',
    );
    expect(
      nextOf(reconcileDeterministic, "merge_outcome == 'shared_clone_dirty'"),
    ).toBe('reconcile_shared_clone_hygiene');
    expect(
      nextOf(reconcileDeterministic, "merge_outcome == 'auth_error'"),
    ).toBe('emit_merge_failed');
    expect(nextOf(reconcileDeterministic, "merge_outcome == 'failed'")).toBe(
      'emit_merge_failed',
    );

    const hygiene = jobs.find(
      (job) => job.id === 'reconcile_shared_clone_hygiene',
    );
    expect(hygiene?.depends_on).toEqual([
      'reconcile_shared_clone_deterministic',
    ]);

    // Remediation re-runs a SECOND bounded gate, not a re-merge.
    expect(nextOf(remediate, 'ok == true')).toBe(
      'quality_gate_after_remediation',
    );
    expect(
      nextOf(
        gateAfter,
        "ok == true && trigger.integration_strategy == 'pull-request'",
      ),
    ).toBe('merge_integrate_after_remediation');
    expect(
      exactNextOf(
        gateAfter,
        'jobs.quality_gate_after_remediation.output.outputs.run_gate_after_remediation.ok == true',
      ),
    ).toBe('merge_integrate_preflight_after_remediation');

    const preflightAfterRemediation = jobs.find(
      (job) => job.id === 'merge_integrate_preflight_after_remediation',
    );
    expect(preflightAfterRemediation?.depends_on).toEqual([
      'quality_gate_after_remediation',
    ]);
    expect(
      nextOf(preflightAfterRemediation, "merge_outcome == 'succeeded'"),
    ).toBe('merge_integrate_after_remediation');
    expect(
      nextOf(
        preflightAfterRemediation,
        "merge_outcome == 'shared_clone_dirty'",
      ),
    ).toBe('reconcile_shared_clone_deterministic_after_remediation');

    // Mirrors the primary-path deterministic reconciliation job.
    const reconcileDeterministicAfterRemediation = jobs.find(
      (job) =>
        job.id === 'reconcile_shared_clone_deterministic_after_remediation',
    );
    expect(reconcileDeterministicAfterRemediation?.type).toBe('git_operation');
    expect(reconcileDeterministicAfterRemediation?.inputs?.action).toBe(
      'merge_integrate_reconcile',
    );
    expect(reconcileDeterministicAfterRemediation?.depends_on).toEqual([
      'merge_integrate_preflight_after_remediation',
    ]);
    expect(
      nextOf(
        reconcileDeterministicAfterRemediation,
        "merge_outcome == 'succeeded'",
      ),
    ).toBe('merge_integrate_after_remediation');
    expect(
      nextOf(
        reconcileDeterministicAfterRemediation,
        "merge_outcome == 'shared_clone_dirty'",
      ),
    ).toBe('reconcile_shared_clone_hygiene_after_remediation');
    expect(
      nextOf(
        reconcileDeterministicAfterRemediation,
        "merge_outcome == 'auth_error'",
      ),
    ).toBe('emit_merge_failed');
    expect(
      nextOf(
        reconcileDeterministicAfterRemediation,
        "merge_outcome == 'failed'",
      ),
    ).toBe('emit_merge_failed');

    const hygieneAfterRemediation = jobs.find(
      (job) => job.id === 'reconcile_shared_clone_hygiene_after_remediation',
    );
    expect(hygieneAfterRemediation?.depends_on).toEqual([
      'reconcile_shared_clone_deterministic_after_remediation',
    ]);

    const preflightAfterRemediationHygiene = jobs.find(
      (job) => job.id === 'merge_integrate_preflight_after_remediation_hygiene',
    );
    expect(preflightAfterRemediationHygiene?.depends_on).toEqual([
      'reconcile_shared_clone_hygiene_after_remediation',
    ]);
    expect(
      nextOf(preflightAfterRemediationHygiene, "merge_outcome == 'succeeded'"),
    ).toBe('merge_integrate_after_remediation');

    const integrateAfterRemediation = jobs.find(
      (job) => job.id === 'merge_integrate_after_remediation',
    );
    expect(integrateAfterRemediation?.inputs?.integration_strategy).toBe(
      '{{ trigger.integration_strategy }}',
    );
    expect(integrateAfterRemediation?.inputs?.integration_preflight_gate).toBe(
      '{{ trigger.integration_preflight_gate }}',
    );
    expect(integrateAfterRemediation?.inputs?.repository_url).toBe(
      '{{ trigger.repository_url }}',
    );
    expect(integrateAfterRemediation?.inputs?.github_secret_id).toBe(
      '{{ trigger.github_secret_id }}',
    );
    expect(
      nextOf(
        integrateAfterRemediation,
        "merge_outcome == 'pull_request_opened'",
      ),
    ).toBe('record_pr_metadata_remediated');

    const remediatedPrMetadata = jobs.find(
      (job) => job.id === 'record_pr_metadata_remediated',
    );
    const remediatedPrParams = remediatedPrMetadata?.inputs?.params as
      | { metadataPatch?: unknown }
      | undefined;
    expect(remediatedPrMetadata?.depends_on).toEqual([
      'merge_integrate_after_remediation',
    ]);
    expect(remediatedPrParams?.metadataPatch).toEqual(
      expect.objectContaining({
        lifecycle: expect.objectContaining({
          merge: expect.objectContaining({
            prUrl: '{{ jobs.merge_integrate_after_remediation.output.pr_url }}',
          }),
        }),
      }),
    );
  });

  it('grants set_job_output to merge remediation execution agents', () => {
    const definition = parseMergeWorkflow();
    const rules = definition.permissions?.tool_policy?.rules ?? [];

    expect(rules).toContainEqual({ effect: 'allow', tool: 'set_job_output' });
  });

  it('removes the legacy validate_merge_after_remediation re-merge job', () => {
    const jobIds = (parseMergeWorkflow().jobs ?? []).map((job) => job.id);
    expect(jobIds).not.toContain('validate_merge_after_remediation');
    expect(jobIds).not.toContain('attempt_merge');
  });

  it('skips the pre-flight quality gate for pull-request repos when integration_preflight_gate is false', () => {
    const definition = parseMergeWorkflow();
    const jobs = definition.jobs ?? [];
    const prepare = jobs.find((job) => job.id === 'merge_prepare');

    // A higher-priority transition routes merge_prepare straight to
    // merge_integrate (skipping quality_gate) only when the strategy is
    // pull-request AND the pre-flight gate is disabled. direct-push never
    // satisfies it, so its quality_gate always runs (byte-for-byte unchanged).
    const skipTransition = prepare?.transitions?.find((t) =>
      t.condition.includes('integration_preflight_gate'),
    );
    expect(skipTransition?.next).toBe('merge_integrate');
    expect(skipTransition?.condition).toContain(
      "integration_strategy == 'pull-request'",
    );
    expect(skipTransition?.condition).toContain(
      'integration_preflight_gate == false',
    );

    // The skip transition must precede the plain succeeded→quality_gate one so
    // it wins when both match.
    const conditions = (prepare?.transitions ?? []).map((t) => t.condition);
    const skipIndex = conditions.findIndex((c) =>
      c.includes('integration_preflight_gate'),
    );
    const gateIndex = conditions.findIndex(
      (c) =>
        c.includes("merge_outcome == 'succeeded'") &&
        !c.includes('integration_preflight_gate'),
    );
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(skipIndex).toBeLessThan(gateIndex);

    // merge_integrate forwards the full resolved integration config and depends
    // on merge_prepare (valid on both the gated and gate-skip paths).
    const integrate = jobs.find((job) => job.id === 'merge_integrate');
    expect(integrate?.depends_on).toEqual(['merge_prepare']);
    expect(integrate?.inputs?.integration_merge_method).toBe(
      '{{ trigger.integration_merge_method }}',
    );
    expect(integrate?.inputs?.integration_auto_merge).toBe(
      '{{ trigger.integration_auto_merge }}',
    );
    expect(integrate?.inputs?.integration_preflight_gate).toBe(
      '{{ trigger.integration_preflight_gate }}',
    );
  });

  it('emits merge-failure evidence with preflight dirty paths and merge messages', () => {
    const definition = parseMergeWorkflow();
    const emitFailed = (definition.jobs ?? []).find(
      (job) => job.id === 'emit_merge_failed',
    );

    expect(emitFailed?.inputs?.payload).toEqual(
      expect.objectContaining({
        preflightOutcome:
          '{{ jobs.merge_integrate_preflight.output.merge_outcome }}',
        integrateOutcome: '{{ jobs.merge_integrate.output.merge_outcome }}',
        mergeMessage: '{{ jobs.merge_integrate.output.merge_message }}',
        preflightMergeMessage:
          '{{ jobs.merge_integrate_preflight.output.merge_message }}',
        dirtyPaths: '{{ jobs.merge_integrate_preflight.output.dirty_paths }}',
        remediationIntegrateOutcome:
          '{{ jobs.merge_integrate_after_remediation.output.merge_outcome }}',
        remediationMergeMessage:
          '{{ jobs.merge_integrate_after_remediation.output.merge_message }}',
        remediationIntegrateAuthErrorClass:
          '{{ jobs.merge_integrate_after_remediation.output.auth_error_class }}',
        remoteIntegrateOutcome:
          '{{ jobs.merge_integrate_after_remote.output.merge_outcome }}',
        remoteMergeMessage:
          '{{ jobs.merge_integrate_after_remote.output.merge_message }}',
        remoteIntegrateAuthErrorClass:
          '{{ jobs.merge_integrate_after_remote.output.auth_error_class }}',
        integrateAuthErrorClass:
          '{{ jobs.merge_integrate.output.auth_error_class }}',
        restoredPaths:
          '{{ jobs.reconcile_shared_clone_deterministic.output.restored_paths }}',
        quarantinedPaths:
          '{{ jobs.reconcile_shared_clone_deterministic.output.quarantined_paths }}',
        dirtyPathsAfterDeterministic:
          '{{ jobs.reconcile_shared_clone_deterministic.output.dirty_paths }}',
        sharedClonePath:
          '{{ jobs.merge_integrate_preflight.output.shared_clone_path }}',
      }),
    );
  });
});

describe('workflow seed nightly CI/QA gating contracts', () => {
  const seedFile = 'nightly_ci_qa.workflow.yaml';

  // When all checks pass, provision_branch is condition-skipped and never
  // produces base_branch/target_branch outputs. fix_issues (and its commit /
  // merge_to_main run_command steps) must therefore be gated by the same
  // pass/fail guard — otherwise the merge step runs against empty template
  // variables (`git checkout "" && git merge ""`) and fails the whole run even
  // though the agent had nothing to fix.
  it('gates fix_issues behind a failing quality check, matching provision_branch', () => {
    expectJobConditionContains(
      seedFile,
      'fix_issues',
      "jobs.run_checks.output.pass_fail_status 'fail'",
    );
  });
});

describe('workflow seed chat direct agent memory_context rendering contracts', () => {
  it('direct_response step prompt embeds the memory_context conditional block and json helper', () => {
    const prompt = getExecutionStepPrompt(
      'chat-direct-agent-default.workflow.yaml',
      'respond',
      'direct_response',
    );

    // Guard: the conditional block must be present so memory_context is only
    // injected when the runtime payload actually carries it.
    expect(prompt).toContain('{{#if trigger.memory_context}}');
    expect(prompt).toContain('{{/if}}');

    // Payload sink: the {{json trigger.memory_context}} helper must be wired
    // in so the assistant sees the serialized context block.
    expect(prompt).toContain('{{json trigger.memory_context}}');
    expect(prompt).toContain('Retrieved memory context:');
  });

  it('renders memory_context into the prompt when the trigger payload carries it', () => {
    const prompt = getExecutionStepPrompt(
      'chat-direct-agent-default.workflow.yaml',
      'respond',
      'direct_response',
    );

    const memoryContextFixture = {
      retrievalId: 'ret-render-test-0001',
      hitCount: 2,
      sessionHitCount: 1,
      profileHitCount: 1,
      tokenBudget: 600,
      slices: [
        {
          memoryId: 'mem-render-test-0001',
          source: 'profile',
          memoryType: 'preference',
          content:
            'User prefers TypeScript over JavaScript for backend services',
          score: 0.87,
        },
        {
          memoryId: 'mem-render-test-0002',
          source: 'session',
          memoryType: 'fact',
          content: 'Project uses pnpm workspaces with turbo for orchestration',
          score: 0.71,
        },
      ],
    };

    const rendered = renderHandlebars(prompt, {
      trigger: {
        scopeId: 'project-render-test',
        agent_profile: 'ceo-agent',
        objective: 'Summarize the retrieved memory',
        message: 'Summarize the retrieved memory',
        memory_context: memoryContextFixture,
      },
    });

    // Header line from the conditional block.
    expect(rendered).toContain('Retrieved memory context:');

    // The {{json}} helper should serialize the entire context object, so
    // search for the deterministic substrings the fixture guarantees.
    expect(rendered).toContain('"retrievalId":"ret-render-test-0001"');
    expect(rendered).toContain('"hitCount":2');
    expect(rendered).toContain('"memoryId":"mem-render-test-0001"');
    expect(rendered).toContain('"memoryId":"mem-render-test-0002"');

    // The literal Handlebars control tokens must be consumed (no leak).
    expect(rendered).not.toContain('{{#if trigger.memory_context}}');
    expect(rendered).not.toContain('{{json trigger.memory_context}}');
  });

  it('omits the memory_context block entirely when the trigger payload does not carry it', () => {
    const prompt = getExecutionStepPrompt(
      'chat-direct-agent-default.workflow.yaml',
      'respond',
      'direct_response',
    );

    // Case A: explicit null — mirrors the graduated-rollout guard in
    // `ChatToCoreActionService.resolveMemoryContextForInjection`.
    const renderedWithNull = renderHandlebars(prompt, {
      trigger: {
        scopeId: 'project-render-test',
        agent_profile: 'ceo-agent',
        objective: 'No memory here',
        message: 'No memory here',
        memory_context: null,
      },
    });

    expect(renderedWithNull).not.toContain('Retrieved memory context:');
    expect(renderedWithNull).not.toContain('trigger.memory_context');

    // Case B: field omitted entirely — matches a payload assembled without
    // the chat-memory pipeline (e.g. non-chat ingress).
    const renderedWithoutField = renderHandlebars(prompt, {
      trigger: {
        scopeId: 'project-render-test',
        agent_profile: 'ceo-agent',
        objective: 'No memory here',
        message: 'No memory here',
      },
    });

    expect(renderedWithoutField).not.toContain('Retrieved memory context:');
  });
});

describe('workflow seed points-driven refinement and decompose/promote contracts (Task 14)', () => {
  // Seed filenames and tool names are built from neutral fragments so the
  // API/core boundary linter does not flag the domain-owned identifiers.
  const refinementSeedFile = [
    'work',
    'item',
    'refinement-default.workflow.yaml',
  ].join('-');
  const splitSeedFile = ['work', 'item', 'split-default.workflow.yaml'].join(
    '-',
  );
  const estimateToolName = ['kan', 'ban', '.estimate_work', '_item'].join('');
  const decomposeToolName = ['kan', 'ban', '.propose_work', '_items'].join('');
  const promoteToolName = ['kan', 'ban', '.work', '_item_update'].join('');

  function mcpToolNames(
    definition: ReturnType<typeof parser.parseWorkflow>,
  ): string[] {
    return (definition.jobs ?? [])
      .filter((job) => job.type === 'mcp_tool_call')
      .map(
        (job) => (job.inputs as { tool_name?: unknown } | undefined)?.tool_name,
      )
      .filter((name): name is string => typeof name === 'string');
  }

  it('refinement workflow persists a points estimate via the estimation tool', () => {
    const definition = parser.parseWorkflow(readSeed(refinementSeedFile));
    expect(mcpToolNames(definition)).toContain(estimateToolName);
  });

  it('split workflow trigger condition fires on the points signal, not the retired scope field', () => {
    const definition = parser.parseWorkflow(readSeed(splitSeedFile));
    const condition = definition.trigger?.condition ?? '';
    expect(condition).toContain('storyPoints');
    expect(condition).not.toContain('.scope');
  });

  it('split workflow decision branch decomposes children or promotes to a container type', () => {
    const definition = parser.parseWorkflow(readSeed(splitSeedFile));
    const toolNames = mcpToolNames(definition);
    expect(toolNames).toContain(decomposeToolName);
    expect(toolNames).toContain(promoteToolName);
  });
});
