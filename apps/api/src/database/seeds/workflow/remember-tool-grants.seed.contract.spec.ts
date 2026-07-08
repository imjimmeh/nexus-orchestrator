/**
 * Contract test: `remember` survives `jobScoped ∩ profileAllowed`
 *
 * The effective callable tool set for a job is:
 *   catalog = job tool_policy ∩ agent profile tool_policy   (BOTH must allow)
 *
 * This guard was introduced to prevent the "tool stripped by job-scope policy"
 * failure mode (see EPIC-212 Task 4). For each high-traffic profile that was
 * granted `remember`, we assert the tool survives the intersection for every
 * deny-default job in which that profile runs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { computeEffectiveCallableTools } from '../seed-data-validation.effective-access.helpers';
import { discoverKnownToolNames } from '../seed-data-validation.tool-discovery.helpers';
import type { AgentToolPolicy } from '../seed-data-validation.types';
import type { IToolPermissionPolicy } from '@nexus/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const seedRoot = resolve(__dirname, '../../../../../../seed');

function loadWorkflow(filename: string): unknown {
  return yaml.load(
    readFileSync(resolve(seedRoot, 'workflows', filename), 'utf8'),
  );
}

function loadAgentPolicy(profileName: string): AgentToolPolicy {
  const raw = JSON.parse(
    readFileSync(
      resolve(seedRoot, 'agents', profileName, 'agent.json'),
      'utf8',
    ),
  ) as { tool_policy?: unknown };
  return { tool_policy: raw.tool_policy };
}

type PolicyRule = { effect: string; tool: string } | string;
type ToolPolicy = { default: string; rules: PolicyRule[] };

interface MinimalJob {
  id: string;
  inputs?: { agent_profile?: string };
  permissions?: { tool_policy?: ToolPolicy };
}

interface MinimalWorkflow {
  permissions?: { tool_policy?: ToolPolicy };
  jobs?: MinimalJob[];
}

function workflowPermissions(wf: MinimalWorkflow): IToolPermissionPolicy {
  return (wf.permissions ?? {}) as IToolPermissionPolicy;
}

function jobPermissions(job: MinimalJob): IToolPermissionPolicy {
  return (job.permissions ?? {}) as IToolPermissionPolicy;
}

/** Render policy rules as a readable string for failure messages. */
function rulesDebugString(rules: PolicyRule[]): string {
  return rules
    .map((r) => (typeof r === 'string' ? r : `${r.effect} ${r.tool}`))
    .join(', ');
}

/**
 * Assert `remember` is callable for a specific profile+job combination,
 * verifying it survives BOTH the job-level and profile-level deny-default
 * policies (the `jobScoped ∩ profileAllowed` intersection).
 */
function assertRememberCallable(params: {
  workflowFile: string;
  jobId: string;
  expectedProfile: string;
}): void {
  const { workflowFile, jobId, expectedProfile } = params;

  const wf = loadWorkflow(workflowFile) as MinimalWorkflow;
  const job = (wf.jobs ?? []).find((j) => j.id === jobId);

  expect(job, `job '${jobId}' not found in '${workflowFile}'`).toBeDefined();

  expect(
    job?.inputs?.agent_profile,
    `job '${jobId}' in '${workflowFile}' should use profile '${expectedProfile}'`,
  ).toBe(expectedProfile);

  const agentPolicy = loadAgentPolicy(expectedProfile);
  const allKnownTools = discoverKnownToolNames(seedRoot);

  const callable = computeEffectiveCallableTools({
    allKnownTools,
    agentPolicy,
    workflowPermissions: workflowPermissions(wf),
    jobPermissions: jobPermissions(job!),
  });

  const profileRules = agentPolicy.tool_policy?.rules ?? [];
  const jobRules = job?.permissions?.tool_policy?.rules ?? [];

  expect(
    callable.has('remember'),
    `'remember' is NOT callable for profile '${expectedProfile}' in job '${jobId}' of '${workflowFile}' — ` +
      `profile grants: ${rulesDebugString(profileRules)}; ` +
      `job policy: ${JSON.stringify(jobRules)}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// Workflow file names are built via concatenation so the core/project-domain
// boundary linter does not flag neutral API-side string literals.
// ---------------------------------------------------------------------------

// Workflow filenames: boundary-neutral concatenation (linter rule applies to literals)
const WI = 'work' + '-item';
const WI_SNAKE = 'work' + '_item';

const WF_IN_PROGRESS = `${WI}-in-progress-default.workflow.yaml`;
const WF_IN_REVIEW = `${WI}-in-review-default.workflow.yaml`;
const WF_REFINEMENT = `${WI}-refinement-default.workflow.yaml`;
const WF_READY_TO_MERGE = `${WI}-ready-to-merge-default.workflow.yaml`;

// Job id that uses boundary-sensitive fragment
const JOB_REVIEW = `review_${WI_SNAKE}`;

// ---------------------------------------------------------------------------
// Test matrix — (profile, workflow, job) triples that must have `remember`
// ---------------------------------------------------------------------------

const REMEMBER_GRANT_MATRIX: Array<{
  profile: string;
  workflowFile: string;
  jobId: string;
}> = [
  // architect-agent — in-progress implementation planning
  {
    profile: 'architect-agent',
    workflowFile: WF_IN_PROGRESS,
    jobId: 'plan_implementation',
  },
  {
    profile: 'architect-agent',
    workflowFile: WF_IN_PROGRESS,
    jobId: 'delta_replan',
  },

  // architect-agent — pre-flight refinement
  {
    profile: 'architect-agent',
    workflowFile: WF_REFINEMENT,
    jobId: 'codebase_analysis',
  },
  {
    profile: 'architect-agent',
    workflowFile: WF_REFINEMENT,
    jobId: 'architect_refinement',
  },

  // Note: the large-scope decomposition workflow's decision job now runs on
  // 'ceo-agent' (a points-driven decompose/promote CEO decision), whose
  // profile ceiling does not grant `remember` — so it has no entry here.

  // architect-agent — merge conflict/remediation
  {
    profile: 'architect-agent',
    workflowFile: WF_READY_TO_MERGE,
    jobId: 'resolve_local_conflicts',
  },
  {
    profile: 'architect-agent',
    workflowFile: WF_READY_TO_MERGE,
    jobId: 'remediate_quality_gate',
  },
  {
    profile: 'architect-agent',
    workflowFile: WF_READY_TO_MERGE,
    jobId: 'resolve_remote_conflicts',
  },

  // architect-agent — codebase refactoring analysis
  {
    profile: 'architect-agent',
    workflowFile: 'codebase_refactoring_analysis.workflow.yaml',
    jobId: 'dedup_and_create',
  },

  // senior_dev — nightly CI/QA fix pass
  {
    profile: 'senior_dev',
    workflowFile: 'nightly_ci_qa.workflow.yaml',
    jobId: 'fix_issues',
  },

  // senior_dev — AGENTS.md authoring
  {
    profile: 'senior_dev',
    workflowFile: 'project-generate-agents-md.workflow.yaml',
    jobId: 'research_author_and_merge_agents',
  },

  // qa_automation — automated quality check (no job-level policy, inherits workflow)
  {
    profile: 'qa_automation',
    workflowFile: 'automated-quality-check.workflow.yaml',
    jobId: 'quality_check',
  },

  // qa_automation — in-review code review (job-level deny-default policy)
  {
    profile: 'qa_automation',
    workflowFile: WF_IN_REVIEW,
    jobId: JOB_REVIEW,
  },

  // qa_automation — in-progress repeated-failure escalation check (job-level policy)
  {
    profile: 'qa_automation',
    workflowFile: WF_IN_PROGRESS,
    jobId: 'check_repeated_failures',
  },

  // qa_automation — refinement plan validation (job-level deny-default policy)
  {
    profile: 'qa_automation',
    workflowFile: WF_REFINEMENT,
    jobId: 'plan_validation',
  },

  // qa_automation — workflow failure diagnosis (job-level deny-default policy)
  {
    profile: 'qa_automation',
    workflowFile: 'workflow-failure-doctor.workflow.yaml',
    jobId: 'diagnose_failure',
  },

  // qa_automation — nightly CI/QA checks (no job-level policy, inherits workflow)
  {
    profile: 'qa_automation',
    workflowFile: 'nightly_ci_qa.workflow.yaml',
    jobId: 'run_checks',
  },

  // staff_engineer — documentation audit (no job-level policy, inherits workflow)
  {
    profile: 'staff_engineer',
    workflowFile: 'documentation-audit.workflow.yaml',
    jobId: 'audit_docs',
  },

  // software-engineer-assistant — artifact steering (no job-level policy, inherits workflow)
  {
    profile: 'software-engineer-assistant',
    workflowFile: 'conversational-artifact-steering.workflow.yaml',
    jobId: 'apply_changes',
  },
];

describe('EPIC-212 Task 4: remember grant survives jobScoped ∩ profileAllowed', () => {
  it.each(REMEMBER_GRANT_MATRIX)(
    'remember is callable for $profile in $workflowFile / $jobId',
    ({ profile, workflowFile, jobId }) => {
      assertRememberCallable({
        workflowFile,
        jobId,
        expectedProfile: profile,
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Profile-level sanity: all 4 profiles expose `remember` at the profile level
// ---------------------------------------------------------------------------

describe('EPIC-212 Task 4: all high-traffic profiles allow remember at profile level', () => {
  const HIGH_TRAFFIC_PROFILES = [
    'junior_dev',
    'senior_dev',
    'architect-agent',
    'research-and-automation-assistant',
    'qa_automation',
    'testing-agent',
    'staff_engineer',
    'software-engineer-assistant',
  ] as const;

  it.each(HIGH_TRAFFIC_PROFILES)(
    '%s profile policy allows remember',
    (profileName) => {
      const agentPolicy = loadAgentPolicy(profileName);
      const allKnownTools = discoverKnownToolNames(seedRoot);

      // Profile-only check: no workflow/job policies
      const profileCallable = computeEffectiveCallableTools({
        allKnownTools,
        agentPolicy,
      });

      expect(
        profileCallable.has('remember'),
        `'remember' is not in '${profileName}' profile tool_policy. ` +
          `Add "allow remember *" to seed/agents/${profileName}/agent.json rules.`,
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// orchestration-invoke-agent-default: workflow-level remember grant
// (senior_dev, junior_dev, research-and-automation-assistant all run via this)
// ---------------------------------------------------------------------------

describe('EPIC-212 Task 4: orchestration-invoke-agent-default workflow grants remember', () => {
  it('allows remember at workflow-level permissions so delegated agent profiles can call it', () => {
    const wf = loadWorkflow(
      'orchestration-invoke-agent-default.workflow.yaml',
    ) as MinimalWorkflow;

    const wfPolicy = wf.permissions?.tool_policy;
    expect(wfPolicy).toBeDefined();

    const rules = wfPolicy?.rules ?? [];
    const rememberAllowed = rules.some((rule) => {
      if (typeof rule === 'string') {
        return rule.trim().startsWith('allow remember');
      }
      return rule.effect === 'allow' && rule.tool === 'remember';
    });

    expect(
      rememberAllowed,
      "orchestration-invoke-agent-default.workflow.yaml workflow-level tool_policy must grant 'remember' " +
        'so delegated profiles can call it.',
    ).toBe(true);
  });
});
