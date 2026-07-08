import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WorkflowParserService } from '../workflow-parser.service';
import { IWorkflowDefinition, IJob, ToolPolicyEffect } from '@nexus/core';

const parser = new WorkflowParserService();
const seedsDir = resolve(__dirname, '../../../../../seed/workflows');
const promptsDir = resolve(seedsDir, 'prompts');

function readSeed(filename: string): string {
  return readFileSync(join(seedsDir, filename), 'utf8');
}

function parseSeed(filename: string): IWorkflowDefinition {
  return parser.parseWorkflow(readSeed(filename));
}

function getJob(
  definition: IWorkflowDefinition,
  jobId: string,
): IJob | undefined {
  return (definition.jobs ?? []).find((j) => j.id === jobId);
}

function getStepPrompt(
  definition: IWorkflowDefinition,
  jobId: string,
  stepId: string,
): string {
  const job = getJob(definition, jobId);
  const step = job?.steps?.find((s) => s.id === stepId);
  return typeof step?.prompt === 'string' ? step.prompt : '';
}

function readPromptFile(relativePath: string): string {
  const fullPath = resolve(promptsDir, relativePath);
  return readFileSync(fullPath, 'utf8');
}

describe('Task 9: orchestration-invoke-agent-default remains delegation-only', () => {
  const filename = 'orchestration-invoke-agent-default.workflow.yaml';
  const delegateRequiredFields = [
    'summary',
    'resource_specs_changed',
    'resource_spec_paths',
  ];
  let definition: IWorkflowDefinition;

  it('has set_job_output in allow_tools', () => {
    definition = parseSeed(filename);
    const rules = definition.permissions?.tool_policy?.rules ?? [];
    const hasSetJobOutput = rules.some((rule) => {
      if (typeof rule === 'string') {
        return rule.includes('set_job_output');
      }
      return (
        rule.tool === 'set_job_output' &&
        (rule.effect === ToolPolicyEffect.ALLOW ||
          rule.effect === ToolPolicyEffect.REQUIRE_APPROVAL)
      );
    });
    expect(hasSetJobOutput).toBe(true);
  });

  it('does not include a follow-up publication job', () => {
    definition = parseSeed(filename);
    expect(definition.jobs?.map((job) => job.id)).toEqual(['delegate']);
  });

  it('delegate prompt requires JSON boolean true/false for resource_specs_changed', () => {
    definition = parseSeed(filename);
    const prompt = getStepPrompt(definition, 'delegate', 'delegated_task');
    const delegate = getJob(definition, 'delegate');

    expect(delegate?.output_contract?.required).toEqual(delegateRequiredFields);
    expect(prompt).toContain('- resource_specs_changed: boolean true/false');
    expect(prompt).toContain('- resource_spec_paths: string[]');
    expect(prompt).toContain(
      'data: { summary: "...", resource_specs_changed: false, resource_spec_paths: [] }',
    );
    expect(prompt).toMatch(/boolean\s+true/i);
  });

  it('delegate prompt uses neutral resource spec fields', () => {
    definition = parseSeed(filename);
    const prompt = getStepPrompt(definition, 'delegate', 'delegated_task');

    expect(prompt).toContain('resource_specs_changed');
    expect(prompt).toContain('resource_spec_paths');
    expect(prompt).toContain('resource spec files');
  });
});

describe('Task 17: cycle-decision loop guard', () => {
  const promptContent = readPromptFile(
    'project-orchestration-cycle-ceo/dispatch.md',
  );

  it('contains ready_for_cycle loop guard', () => {
    expect(promptContent).toContain('ready_for_cycle');
  });

  it('contains recent discovery context for blocking', () => {
    expect(promptContent).toMatch(/recent\s+discovery/i);
  });

  it('contains do not invoke discovery again instruction', () => {
    expect(promptContent).toMatch(/do not invoke discovery again/i);
  });

  it('requires bootstrap_gap_decision in output', () => {
    expect(promptContent).toContain('bootstrap_gap_decision');
  });

  it('requires recent_discovery_run_id in output', () => {
    expect(promptContent).toContain('recent_discovery_run_id');
  });

  it('requires retry_allowed in output', () => {
    expect(promptContent).toContain('retry_allowed');
  });

  it('instructs agents to pass canonical scope_id for discovery invocation', () => {
    const discoverySection = promptContent.slice(
      promptContent.indexOf('project_discovery_ceo'),
      promptContent.indexOf('## PROJECTED DELEGATION CYCLE'),
    );

    expect(discoverySection).toContain('scope_id');
  });
});

const agentsDir = resolve(__dirname, '../../../../../seed/agents');

function readAgentPrompt(agentDir: string): string {
  const filePath = join(agentsDir, agentDir, 'PROMPT.md');
  if (!existsSync(filePath)) {
    throw new Error(`Required agent prompt fixture is missing: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

const SCOPED_PROMPT_FILES = [
  { name: 'ceo-agent', path: () => readAgentPrompt('ceo-agent') },
  { name: 'spec-generator', path: () => readAgentPrompt('spec-generator') },
  { name: 'product-manager', path: () => readAgentPrompt('product-manager') },
  {
    name: 'dispatch.md',
    path: () => readPromptFile('project-orchestration-cycle-ceo/dispatch.md'),
  },
  {
    name: 'conversational-artifact-steering.workflow.yaml',
    path: () => readSeed('conversational-artifact-steering.workflow.yaml'),
  },
];

describe('Task 10: no commit/merge/git-publication language for publish_specs', () => {
  const gitPublishPatterns = [
    /\bcommit\b.*\bmerge\b/,
    /\bmerge\b.*\bcommit\b/,
    /\bgit\s+publish/i,
    /\bpublish_specs\b.*\bcommit\b/,
    /\bpublish_specs\b.*\bmerge\b/,
    /\bhydrat.*\bcommit\b/i,
    /\bhydrat.*\bmerge\b/i,
    /\bcommit.*hydrat\b/i,
    /\bmerge.*hydrat\b/i,
  ];

  for (const file of SCOPED_PROMPT_FILES) {
    it(`${file.name}: no git-publication language near publish_specs`, () => {
      const content = file.path();
      if (!content.includes('publish_specs') && !content.includes('hydrat'))
        return;

      for (const pattern of gitPublishPatterns) {
        expect(
          pattern.test(content),
          `${file.name} should not match ${pattern}`,
        ).toBe(false);
      }
    });
  }

  it('dispatch.md does not describe publish_specs as committing or merging', () => {
    const content = readPromptFile(
      'project-orchestration-cycle-ceo/dispatch.md',
    );
    const parts = content.split('publish_specs');
    for (let i = 0; i < parts.length - 1; i++) {
      const before = parts[i].slice(-200);
      const after = parts[i + 1].slice(0, 200);
      const surrounding = before + ' ' + after;
      expect(surrounding).not.toMatch(/\bcommit\b/);
      expect(surrounding).not.toMatch(/\bmerge\b/);
    }
  });

  it('product-manager does not mention git publication', () => {
    const content = readAgentPrompt('product-manager');
    expect(content).not.toMatch(/git\s+publication/i);
    expect(content).not.toMatch(/git\s+publishing/i);
  });
});

describe('Task 10: no external.publish_specs.hydration wrapper expectation', () => {
  for (const file of SCOPED_PROMPT_FILES) {
    it(`${file.name}: no .hydration wrapper on publish_specs`, () => {
      const content = file.path();
      expect(content).not.toMatch(/publish_specs\.hydration/);
    });
  }
});

describe('Task 10: scope_id is the canonical neutral scope parameter', () => {
  it('ceo-agent mentions scope_id as canonical parameter', () => {
    const content = readAgentPrompt('ceo-agent');
    expect(content).toContain('scope_id');
    expect(content).not.toMatch(
      /scope_id.*compatibility alias|compatibility alias.*scope_id/i,
    );
  });

  it('spec-generator mentions canonical scope_id parameter', () => {
    const content = readAgentPrompt('spec-generator');
    expect(content).toContain('scope_id');
    expect(content).not.toMatch(
      /scope_id.*compatibility alias|compatibility alias.*scope_id/i,
    );
  });
});

describe('Task 10: direct result fields, no wrapper expectations', () => {
  it('conversational-artifact-steering records direct publish output', () => {
    const content = readSeed('conversational-artifact-steering.workflow.yaml');
    expect(content).toContain('publish_result');
  });
});

describe('Task 10: missing-directory rules documented', () => {
  it('dispatch.md documents publish_specs error handling', () => {
    const content = readPromptFile(
      'project-orchestration-cycle-ceo/dispatch.md',
    );
    expect(content).toContain('publish_specs');
    expect(content).toMatch(/ok:\s*false/);
  });
});

describe('Task 10: ok:false and error handling documented', () => {
  it('dispatch.md instructs honest ok:false handling', () => {
    const content = readPromptFile(
      'project-orchestration-cycle-ceo/dispatch.md',
    );
    expect(content).toMatch(/ok:\s*false/);
  });
});

describe('Task 10: conversational-artifact-steering publish_specs correctness', () => {
  it('does not pass source_branch or base_branch to publish job inputs or prompt', () => {
    const content = readSeed('conversational-artifact-steering.workflow.yaml');
    const definition = parser.parseWorkflow(content);
    const publishJob = getJob(definition, 'publish');
    const prompt = getStepPrompt(definition, 'publish', 'publish_specs');
    expect(publishJob?.inputs).not.toHaveProperty('source_branch');
    expect(publishJob?.inputs).not.toHaveProperty('base_branch');
    expect(prompt).not.toMatch(/source_branch\s*:/);
    expect(prompt).not.toMatch(/base_branch\s*:/);
  });

  it('does not reference validate_specs in artifact steering publish prompt', () => {
    const definition = parseSeed(
      'conversational-artifact-steering.workflow.yaml',
    );
    const prompt = getStepPrompt(definition, 'publish', 'publish_specs');
    expect(prompt).not.toContain('validate_specs');
  });
});
