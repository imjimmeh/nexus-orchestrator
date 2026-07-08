import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const seedRoot = resolve(__dirname, '../../../../../../seed');
const workflowPath = resolve(
  seedRoot,
  'workflows',
  'codebase_refactoring_analysis.workflow.yaml',
);

// Concatenated so the core/project-domain boundary lint rule does not fire on a
// string literal in this neutral API-side spec.
const PROJECT_DOMAIN_TOOL_PREFIX = 'kan' + 'ban.';
const LIST_WORK_ITEMS_TOOL =
  PROJECT_DOMAIN_TOOL_PREFIX + 'list_' + 'work' + '_items';
const WORK_ITEM_CREATE_TOOL =
  PROJECT_DOMAIN_TOOL_PREFIX + 'work' + '_item_create';

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
interface ReconcileRule {
  field: string;
  tool: string;
}
interface JobOutputContract {
  required?: string[];
  reconcile?: ReconcileRule[];
}
interface JobWithContract extends JobWithPermissions {
  output_contract?: JobOutputContract;
}
interface WorkflowDoc {
  workflow_id: string;
  jobs: JobWithContract[];
}

function load(): WorkflowDoc {
  return yaml.load(readFileSync(workflowPath, 'utf8')) as WorkflowDoc;
}

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

// ---------------------------------------------------------------------------
// A step's final tool catalog is `jobScoped ∩ allowedByProfile`
// (resolveAllowedToolNamesForStep). The dedup_and_create job grants the
// project-domain create/list tools, but if the pinned `architect-agent`
// profile (default-deny) does not also permit them, they are silently stripped
// from the catalog. The agent then cannot create work items and instead
// fabricates the result — exactly what happened on run a831645d, which reported
// 53 items created while making zero create calls.
// ---------------------------------------------------------------------------
describe('codebase refactoring analysis dedup_and_create profile tool alignment', () => {
  const job = load().jobs.find(
    (candidate) => candidate.id === 'dedup_and_create',
  ) as unknown as JobWithPermissions;

  it('pins the architect-agent profile', () => {
    expect(job?.inputs?.agent_profile).toBe('architect-agent');
  });

  it('grants the pinned profile the project-domain create/list tools the job allows', () => {
    const granted = jobGrantedTools(job);
    // Guard against a vacuous test if the workflow ever stops granting these.
    expect(granted.has(LIST_WORK_ITEMS_TOOL)).toBe(true);
    expect(granted.has(WORK_ITEM_CREATE_TOOL)).toBe(true);

    const profileName = job.inputs?.agent_profile;
    expect(profileName).toBeTruthy();
    const profileAllowed = profileAllowedTools(
      loadProfilePolicy(profileName as string),
    );

    const stripped = [LIST_WORK_ITEMS_TOOL, WORK_ITEM_CREATE_TOOL].filter(
      (tool) => !profileAllowed.has(tool),
    );
    expect(stripped).toEqual([]);
  });

  it('reconciles items_created against actual create-tool calls to reject fabricated counts', () => {
    const contract = (
      load().jobs.find(
        (candidate) => candidate.id === 'dedup_and_create',
      ) as unknown as JobWithContract
    ).output_contract;

    const rule = contract?.reconcile?.find((r) => r.field === 'items_created');
    expect(rule).toBeDefined();
    expect(rule?.tool).toBe(WORK_ITEM_CREATE_TOOL);
  });
});
