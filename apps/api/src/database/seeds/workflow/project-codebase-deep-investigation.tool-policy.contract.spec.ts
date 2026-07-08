import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const SEED_PATH = resolve(
  __dirname,
  '../../../../../../seed/workflows/project-codebase-deep-investigation.workflow.yaml',
);

interface ToolPolicyRule {
  effect: string;
  tool: string;
}

interface WorkflowJob {
  id: string;
  permissions?: { tool_policy?: { rules?: ToolPolicyRule[] } };
}

interface WorkflowDefinition {
  jobs: WorkflowJob[];
}

function loadWorkflow(): WorkflowDefinition {
  return load(readFileSync(SEED_PATH, 'utf8')) as WorkflowDefinition;
}

function findJob(wf: WorkflowDefinition, id: string): WorkflowJob {
  const job = wf.jobs.find((j) => j.id === id);
  if (!job) throw new Error(`job ${id} not found in workflow seed`);
  return job;
}

function allowedTools(job: WorkflowJob): Set<string> {
  const rules = job.permissions?.tool_policy?.rules ?? [];
  return new Set(rules.filter((r) => r.effect === 'allow').map((r) => r.tool));
}

describe('project-codebase-deep-investigation probe jobs grant read-only search tools', () => {
  // The investigation-coordinator agent profile (seed/agents/investigation-coordinator/agent.json)
  // explicitly grants `grep` and `find` alongside `ls`/`read` — these jobs must not silently
  // strip them via the job-level tool_policy, or the job ∩ profile intersection leaves the
  // coordinator unable to search the codebase it is meant to investigate (a retrospective
  // analysis of run 6371806f-be5f-40ac-bc43-081d3416983d showed exactly this: "Tool grep not
  // found" / "Tool find not found" during run_scope_probes, while ls/read worked fine).
  const jobIds = [
    'coordinate_investigation',
    'run_scope_probes',
    'finalize_investigation_artifacts',
  ];

  for (const jobId of jobIds) {
    it(`grants grep and find on ${jobId} alongside ls/read`, () => {
      const wf = loadWorkflow();
      const job = findJob(wf, jobId);
      const allowed = allowedTools(job);

      expect(allowed.has('ls')).toBe(true);
      expect(allowed.has('read')).toBe(true);
      expect(allowed.has('grep')).toBe(true);
      expect(allowed.has('find')).toBe(true);
    });

    it(`still denies bash on ${jobId} (unchanged security posture)`, () => {
      const wf = loadWorkflow();
      const job = findJob(wf, jobId);
      const rules = job.permissions?.tool_policy?.rules ?? [];
      const bashRule = rules.find((r) => r.tool === 'bash');

      expect(bashRule?.effect).toBe('deny');
    });
  }
});
