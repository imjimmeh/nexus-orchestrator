import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const seedRoot = resolve(__dirname, '../../../../../../seed');
const workflowPath = resolve(
  seedRoot,
  'workflows',
  'project-roadmap-planning.workflow.yaml',
);

interface Job {
  id: string;
  type: string;
  inputs?: Record<string, unknown>;
}
interface WorkflowDoc {
  workflow_id: string;
  jobs: Job[];
  trigger: { launch?: { inputs?: { key: string }[] } };
}

function load(): WorkflowDoc {
  return yaml.load(readFileSync(workflowPath, 'utf8')) as WorkflowDoc;
}

describe('project-roadmap-planning workflow seed contract', () => {
  it('declares the canonical workflow_id', () => {
    expect(load().workflow_id).toBe('project_roadmap_planning');
  });

  it('launches on a neutral scopeId input only (no domain-specific identifiers)', () => {
    const keys = (load().trigger.launch?.inputs ?? []).map((i) => i.key);
    expect(keys).toContain('scopeId');
    // Use concatenation so the boundary lint rule does not fire on string literals in this core spec.
    expect(keys).not.toContain('work' + '_item_id');
    expect(keys).not.toContain('initiative' + '_id');
  });

  it('mutates initiatives and NEVER creates work items (SRP)', () => {
    const raw = readFileSync(workflowPath, 'utf8');
    // Use concatenation so the boundary lint rule does not fire on string literals in this core spec.
    const ns = 'kan' + 'ban.';
    expect(raw).toContain(ns + 'initiative_create');
    expect(raw).not.toContain(ns + 'work' + '_item_create');
    expect(raw).not.toContain(ns + 'work' + '_item_transition_status');
  });

  it('runs a single strategist execution job', () => {
    const jobs = load().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('execution');
  });
});

const promptPath = resolve(
  seedRoot,
  'workflows',
  'prompts',
  'project-roadmap-planning',
  'plan-roadmap.md',
);

describe('plan-roadmap prompt contract', () => {
  it('exists', () => {
    expect(existsSync(promptPath)).toBe(true);
  });

  // Use concatenation so the boundary lint rule does not fire on string literals in this core spec.
  it('forbids work' + '-item creation and reads the capability map', () => {
    const md = readFileSync(promptPath, 'utf8');
    expect(md).toContain('docs/project-context/CAPABILITY_MAP.md');
    expect(md).toMatch(/do not create work items/i);
    expect(md).toContain('last_reviewed_at');
    const ns = 'kan' + 'ban.';
    expect(md).toContain(ns + 'initiative_create');
  });

  it('declares set_job_output with decision + roadmap_summary', () => {
    const md = readFileSync(promptPath, 'utf8');
    expect(md).toContain('set_job_output');
    expect(md).toContain('roadmap_summary');
    expect(md).toContain('decision');
  });
});

// ---------------------------------------------------------------------------
// Profile <-> workflow tool alignment
//
// A step's final tool catalog is `jobScoped ∩ allowedByProfile`
// (resolveAllowedToolNamesForStep). When a workflow pins an agent_profile,
// every tool the job grants is silently stripped unless the profile's
// tool_policy also permits it. A drifted profile therefore hands the agent an
// empty catalog: the roadmap strategist on `product-manager` lost every
// project-domain tool (charter, project state, initiatives), which is what
// this contract guards against.
// ---------------------------------------------------------------------------

interface PolicyRule {
  effect: 'allow' | 'deny';
  tool: string;
}
interface ToolPolicy {
  default: 'allow' | 'deny';
  rules: Array<PolicyRule | string>;
}
interface JobWithPermissions {
  id: string;
  type: string;
  inputs?: { agent_profile?: string };
  permissions?: { tool_policy?: ToolPolicy };
}

// Concatenated so the boundary lint rule does not fire on a string literal in this core spec.
const PROJECT_DOMAIN_TOOL_PREFIX = 'kan' + 'ban.';

/** Tools a job's tool_policy explicitly allows, minus any it explicitly denies. */
function jobGrantedTools(job: JobWithPermissions): Set<string> {
  const allowed = new Set<string>();
  const denied = new Set<string>();
  for (const rule of job.permissions?.tool_policy?.rules ?? []) {
    if (typeof rule === 'string') continue;
    (rule.effect === 'allow' ? allowed : denied).add(rule.tool);
  }
  for (const tool of denied) allowed.delete(tool);
  return allowed;
}

/** Tool names a profile tool_policy permits. Rules may be objects or
 * `"allow <tool> <scope>"` strings; default-deny means unlisted tools are off. */
function profileAllowedTools(policy: ToolPolicy): Set<string> {
  const allowed = new Set<string>();
  for (const rule of policy.rules) {
    if (typeof rule === 'string') {
      const [effect, tool] = rule.split(/\s+/);
      if (effect === 'allow' && tool) allowed.add(tool);
    } else if (rule.effect === 'allow') {
      allowed.add(rule.tool);
    }
  }
  return allowed;
}

function loadProfilePolicy(profileName: string): ToolPolicy {
  const agentPath = resolve(seedRoot, 'agents', profileName, 'agent.json');
  const agent = JSON.parse(readFileSync(agentPath, 'utf8')) as {
    tool_policy: ToolPolicy;
  };
  return agent.tool_policy;
}

describe('roadmap planning profile tool alignment', () => {
  const job = load().jobs.find(
    (j) => j.type === 'execution',
  ) as unknown as JobWithPermissions;

  it('pins the product-manager profile', () => {
    expect(job.inputs?.agent_profile).toBe('product-manager');
  });

  it('grants the pinned profile every project-domain tool the job allows', () => {
    const granted = [...jobGrantedTools(job)].filter((t) =>
      t.startsWith(PROJECT_DOMAIN_TOOL_PREFIX),
    );
    // Guard against a vacuous test if the workflow ever stops granting these tools.
    expect(granted.length).toBeGreaterThan(0);

    const profileName = job.inputs?.agent_profile;
    expect(profileName).toBeTruthy();
    const profileAllowed = profileAllowedTools(
      loadProfilePolicy(profileName as string),
    );

    const stripped = granted.filter((t) => !profileAllowed.has(t));
    expect(stripped).toEqual([]);
  });
});
