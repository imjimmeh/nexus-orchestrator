/**
 * Contract test: EPIC-212 Phase 2 Task 5 — `run_retrospective` analyst seed.
 *
 * The retrospective analyst is a READ-ONLY, light-tier diagnostician. It reads a
 * pre-built digest and emits evidence-cited `findings[]`; it must NEVER mutate
 * anything (no `write`/`edit`/`bash`/`remember`/`create_skill*`/`spawn_*`). The
 * ROUTER (Task 7), not the analyst, writes memories and skill proposals.
 *
 * This guard asserts both the workflow seed and the agent profile seed encode
 * that read-only, light-tier contract, and that the workflow declares `findings`
 * in its output contract (Task 6 reads this back).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const seedRoot = resolve(__dirname, '../../../../../../seed');

const WORKFLOW_FILE = 'run-retrospective.workflow.yaml';
const ANALYST_PROFILE = 'retrospective-analyst';
const PROMPT_FILE = resolve(
  seedRoot,
  'workflows',
  'prompts',
  'run-retrospective',
  'analyze.md',
);

// Tools the analyst must NEVER be granted — it diagnoses, it does not mutate.
const FORBIDDEN_TOOL_PREFIXES = [
  'write',
  'edit',
  'bash',
  'remember',
  'create_skill',
  'update_skill',
  'spawn_',
] as const;

// Tools the analyst MUST be able to call.
const REQUIRED_READ_ONLY_TOOLS = [
  'read',
  'query_memory',
  'set_job_output',
  'step_complete',
] as const;

// ---------------------------------------------------------------------------
// Policy parsing (rules may be `"allow <tool> <scope>"` strings or objects)
// ---------------------------------------------------------------------------

type PolicyRule = { effect: string; tool: string } | string;
interface ToolPolicy {
  default: string;
  rules: PolicyRule[];
}

interface Job {
  id: string;
  type: string;
  tier?: string;
  inputs?: { agent_profile?: string };
  output_contract?: { required?: string[] };
  permissions?: { tool_policy?: ToolPolicy };
}

interface WorkflowDoc {
  workflow_id: string;
  trigger: { type: string; inputs?: { name: string; required?: boolean }[] };
  permissions?: { tool_policy?: ToolPolicy };
  jobs: Job[];
}

function loadWorkflow(): WorkflowDoc {
  return yaml.load(
    readFileSync(resolve(seedRoot, 'workflows', WORKFLOW_FILE), 'utf8'),
  ) as WorkflowDoc;
}

function loadProfile(): { tier_preference: string; tool_policy: ToolPolicy } {
  return JSON.parse(
    readFileSync(
      resolve(seedRoot, 'agents', ANALYST_PROFILE, 'agent.json'),
      'utf8',
    ),
  ) as { tier_preference: string; tool_policy: ToolPolicy };
}

/** Tool names a deny-default policy explicitly allows. */
function allowedTools(policy: ToolPolicy | undefined): Set<string> {
  const allowed = new Set<string>();
  for (const rule of policy?.rules ?? []) {
    if (typeof rule === 'string') {
      const [effect, tool] = rule.trim().split(/\s+/);
      if (effect === 'allow' && tool) allowed.add(tool);
    } else if (rule.effect === 'allow' && rule.tool) {
      allowed.add(rule.tool);
    }
  }
  return allowed;
}

function isForbidden(tool: string): boolean {
  return FORBIDDEN_TOOL_PREFIXES.some((prefix) => tool.startsWith(prefix));
}

function executionJob(wf: WorkflowDoc): Job {
  const job = wf.jobs.find((j) => j.type === 'execution');
  expect(job, 'run_retrospective must declare an execution job').toBeDefined();
  return job as Job;
}

// ---------------------------------------------------------------------------
// Workflow contract
// ---------------------------------------------------------------------------

describe('run_retrospective workflow seed contract', () => {
  it('declares the canonical workflow_id', () => {
    expect(loadWorkflow().workflow_id).toBe('run_retrospective');
  });

  it('is manually triggered and requires workflow_run_id + digest', () => {
    const trigger = loadWorkflow().trigger;
    expect(trigger.type).toBe('manual');
    const required = (trigger.inputs ?? [])
      .filter((i) => i.required)
      .map((i) => i.name);
    expect(required).toContain('workflow_run_id');
    expect(required).toContain('digest');
  });

  it('uses a neutral scope_id input (no domain-specific identifiers)', () => {
    const names = (loadWorkflow().trigger.inputs ?? []).map((i) => i.name);
    expect(names).toContain('scope_id');
    // Concatenated so the boundary lint rule does not fire on string literals.
    expect(names).not.toContain('work' + '_item_id');
    expect(names).not.toContain('project' + '_id');
  });

  it('declares an optional workflow_yaml trigger input (Task 9: definition-change context)', () => {
    const inputs = loadWorkflow().trigger.inputs ?? [];
    const workflowYamlInput = inputs.find((i) => i.name === 'workflow_yaml');
    expect(
      workflowYamlInput,
      'run_retrospective must declare a workflow_yaml trigger input',
    ).toBeDefined();
    expect(workflowYamlInput?.required).toBeFalsy();
  });

  it('declares an optional acting_agent_profiles trigger input (Task 9 fix: profile-change context)', () => {
    const inputs = loadWorkflow().trigger.inputs ?? [];
    const actingProfilesInput = inputs.find(
      (i) => i.name === 'acting_agent_profiles',
    );
    expect(
      actingProfilesInput,
      'run_retrospective must declare an acting_agent_profiles trigger input',
    ).toBeDefined();
    expect(actingProfilesInput?.required).toBeFalsy();
  });

  it('runs a single light-tier execution job pinned to the analyst profile', () => {
    const wf = loadWorkflow();
    expect(wf.jobs).toHaveLength(1);
    const job = executionJob(wf);
    expect(job.tier).toBe('light');
    expect(job.inputs?.agent_profile).toBe(ANALYST_PROFILE);
  });

  it('declares findings in its output contract', () => {
    expect(executionJob(loadWorkflow()).output_contract?.required).toContain(
      'findings',
    );
  });

  it('grants the required read-only analyst tools', () => {
    const wf = loadWorkflow();
    const granted = allowedTools(wf.permissions?.tool_policy);
    for (const tool of REQUIRED_READ_ONLY_TOOLS) {
      expect(
        granted.has(tool),
        `workflow must grant read-only tool '${tool}'`,
      ).toBe(true);
    }
  });

  it('is READ-ONLY — never grants a mutating tool at workflow or job level', () => {
    const wf = loadWorkflow();
    const policies: Array<ToolPolicy | undefined> = [
      wf.permissions?.tool_policy,
      ...wf.jobs.map((j) => j.permissions?.tool_policy),
    ];
    for (const policy of policies) {
      expect(policy?.default ?? 'deny').toBe('deny');
      const offending = [...allowedTools(policy)].filter(isForbidden);
      expect(
        offending,
        `run_retrospective must not grant mutating tools, found: ${offending.join(', ')}`,
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Agent profile contract
// ---------------------------------------------------------------------------

describe('retrospective-analyst profile seed contract', () => {
  it('is light-tier (cheap diagnosis)', () => {
    expect(loadProfile().tier_preference).toBe('light');
  });

  it('is deny-default and grants no mutating tools', () => {
    const profile = loadProfile();
    expect(profile.tool_policy.default).toBe('deny');
    const offending = [...allowedTools(profile.tool_policy)].filter(
      isForbidden,
    );
    expect(
      offending,
      `retrospective-analyst must not grant mutating tools, found: ${offending.join(', ')}`,
    ).toEqual([]);
  });

  it('grants the required read-only diagnosis tools', () => {
    const granted = allowedTools(loadProfile().tool_policy);
    for (const tool of REQUIRED_READ_ONLY_TOOLS) {
      expect(granted.has(tool), `profile must grant '${tool}'`).toBe(true);
    }
  });

  it('ships a non-empty PROMPT.md (required for the profile to seed)', () => {
    const promptPath = resolve(
      seedRoot,
      'agents',
      ANALYST_PROFILE,
      'PROMPT.md',
    );
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(promptPath, 'utf8').trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Prompt contract — forbids invention, mandates evidence + the finding shape
// ---------------------------------------------------------------------------

describe('run-retrospective analyze prompt contract', () => {
  it('exists', () => {
    expect(existsSync(PROMPT_FILE)).toBe(true);
  });

  it('reads the digest, emits findings via set_job_output, and forbids invention', () => {
    const md = readFileSync(PROMPT_FILE, 'utf8');
    expect(md).toContain('trigger.digest');
    expect(md).toContain('set_job_output');
    expect(md).toContain('findings');
    expect(md).toContain('evidence_event_ids');
    expect(md).toContain('query_memory');
    // The single-`none` discipline + the no-invention rail.
    expect(md).toMatch(/none/);
    expect(md).toMatch(/never invent|do not invent|not invent/i);
  });

  it('enumerates the full RetrospectiveFinding shape (Task 6 parses this)', () => {
    const md = readFileSync(PROMPT_FILE, 'utf8');
    for (const field of [
      'kind',
      'lesson',
      'root_cause',
      'fix',
      'working_procedure',
      'scope_hint',
      'confidence_self',
    ]) {
      expect(md, `prompt must document the '${field}' finding field`).toContain(
        field,
      );
    }
  });

  it('documents both definition-change finding kinds and their payloads (Task 9)', () => {
    const md = readFileSync(PROMPT_FILE, 'utf8');
    expect(md).toContain('agent_profile_change');
    expect(md).toContain('workflow_definition_change');
    expect(md).toContain('profile_change');
    expect(md).toContain('workflow_change');
    expect(md).toContain('proposedYaml');
    expect(md).toContain('changeSummary');
    // The analyst must be told it needs workflow_yaml to propose a definition change.
    expect(md).toContain('workflow_yaml');
    // The analyst must be told it needs acting_agent_profiles — not the digest —
    // to propose an agent_profile_change (closes the profileName hallucination risk).
    expect(md).toContain('acting_agent_profiles');
  });
});
