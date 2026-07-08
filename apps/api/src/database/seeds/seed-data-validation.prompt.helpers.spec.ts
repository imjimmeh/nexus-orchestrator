import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectUnguardedGoalPlaceholders,
  extractPromptToolReferenceCandidates,
} from './seed-data-validation.prompt.helpers';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf-8');
}

function extractProbeLoopSpawnTools(prompt: string): string[] {
  const toolsMatch = prompt.match(/^- tools:\s*\[(?<tools>[^\]]+)\]/m);
  expect(toolsMatch?.groups?.tools).toBeDefined();

  return (
    toolsMatch?.groups?.tools
      .split(',')
      .map((tool) => tool.trim().replace(/^"|"$/g, '')) ?? []
  );
}

describe('seed prompt validation helpers', () => {
  describe('extractPromptToolReferenceCandidates', () => {
    it('extracts tool-like references from prompt instructions', () => {
      const content = [
        '1. Call `query_memory`.',
        '2. Then call submit_orchestration_decision.',
        '3. When calling `invoke_agent_workflow`, use agent_profile only.',
        '4. Finish by calling `step_complete`.',
      ].join('\n');

      expect(extractPromptToolReferenceCandidates(content)).toEqual([
        'invoke_agent_workflow',
        'query_memory',
        'step_complete',
        'submit_orchestration_decision',
      ]);
    });

    it('does not treat schema fields or workflow ids as tool references', () => {
      const content = [
        'Write markdown with `item_id`, `title`, and `depends_on_item_ids`.',
        'You may use workflow_id `project_orchestration_refinement_ceo` when approved.',
      ].join('\n');

      expect(extractPromptToolReferenceCandidates(content)).toEqual([]);
    });
  });

  describe('detectUnguardedGoalPlaceholders', () => {
    it('flags unguarded goals placeholders', () => {
      const content = [
        '**Project Goals:** {{inputs.goals}}',
        '- Goals: {{trigger.goals}}',
      ].join('\n');

      expect(detectUnguardedGoalPlaceholders(content)).toEqual([
        'inputs.goals',
        'trigger.goals',
      ]);
    });

    it('allows goals placeholders when they are wrapped in if guards', () => {
      const content = [
        '{{#if inputs.goals}}',
        '**Project Goals:** {{inputs.goals}}',
        '{{/if}}',
        '{{#if trigger.goals}}',
        '- Goals: {{trigger.goals}}',
        '{{/if}}',
      ].join('\n');

      expect(detectUnguardedGoalPlaceholders(content)).toEqual([]);
    });
  });

  describe('orchestration prompt contracts', () => {
    it('does not advertise unavailable update_project_strategy tooling', () => {
      const cycleWorkflow = readRepoFile(
        'seed/workflows/project-orchestration-cycle-ceo.workflow.yaml',
      );
      const refinementWorkflow = readRepoFile(
        'seed/workflows/project-orchestration-refinement-ceo.workflow.yaml',
      );
      const ceoAgent = readRepoFile('seed/agents/ceo-agent/agent.json');
      const ceoPrompt = readRepoFile('seed/agents/ceo-agent/PROMPT.md');
      const nextCyclePlanningSkill = readRepoFile(
        'seed/skills/orchestration-playbooks/next-cycle-planning/SKILL.md',
      );

      expect(cycleWorkflow).not.toContain('update_project_strategy');
      expect(refinementWorkflow).not.toContain('update_project_strategy');
      expect(ceoAgent).not.toContain('update_project_strategy');
      expect(ceoPrompt).not.toContain('update_project_strategy');
      expect(nextCyclePlanningSkill).not.toContain('update_project_strategy');
    });

    it('requires optional project-context files to be discovered before reading', () => {
      const prompt = readRepoFile(
        'seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md',
      );

      expect(prompt).toContain('ls');
      expect(prompt).toContain('missing_ok: true');
      expect(prompt).toContain('If `docs/project-context/` exists');
      expect(prompt).toContain(
        'Missing project-context files are not blockers',
      );
    });

    it('requires advisor consultation before bootstrap delegation when goals are not decomposed into dispatchable context', () => {
      const prompt = readRepoFile(
        'seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md',
      );

      expect(prompt).toContain(
        'If there are persisted goals but zero dispatchable context items',
      );
      expect(prompt).toContain('delegate_orchestration_advisor');
      expect(prompt).toContain(
        'Do not invent or read an `adviceMarkdown` field',
      );
      expect(prompt).toContain('bootstrap_gap_decision');
      expect(prompt).not.toContain('invoke_agent_workflow');
    });

    it('does not advertise discovery workflow as a generic mid-flight target', () => {
      const prompt = readRepoFile(
        'seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md',
      );

      expect(prompt).toContain(
        'Use projected delegation only for the explicit planning, bootstrap, advisory, spec, and generation paths',
      );
      expect(prompt).not.toContain('- workflow_id `project_discovery_ceo`');
      expect(prompt).not.toContain('invoke_agent_workflow');
    });
  });

  describe('investigation workflow spawn tools', () => {
    it('includes find and grep in probe-loop spawn tools list', () => {
      const prompt = readRepoFile(
        'seed/workflows/prompts/project-codebase-deep-investigation/probe-loop.md',
      );

      const spawnTools = extractProbeLoopSpawnTools(prompt);

      expect(spawnTools).toEqual(
        expect.arrayContaining([
          'read',
          'ls',
          'find',
          'grep',
          'bash',
          'write',
          'edit',
        ]),
      );
    });

    it('tells subagents to prefer direct discovery tools before bash fallback', () => {
      const prompt = readRepoFile(
        'seed/workflows/prompts/project-codebase-deep-investigation/probe-loop.md',
      );

      expect(prompt).toContain(
        'Prefer direct tools: ls, find, grep, and read.',
      );
      expect(prompt).toContain(
        'Use bash only when direct tools cannot express the read-only discovery operation.',
      );
      expect(prompt).toContain(
        'Do not use shell redirection, pipes, command chaining, mutating commands, package managers, network commands, interpreters, process control, or git commands.',
      );
    });
  });
});
