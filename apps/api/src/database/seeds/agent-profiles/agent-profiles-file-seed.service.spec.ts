import { ToolPolicyEffect } from '@nexus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentProfilesFileSeedService } from './agent-profiles-file-seed.service';

describe('AgentProfilesFileSeedService', () => {
  let tempRoot: string;
  let agentsRoot: string;
  let assignmentsPath: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-file-seed-'));
    agentsRoot = path.join(tempRoot, 'seed', 'agents');
    assignmentsPath = path.join(agentsRoot, 'skill-assignments.seed.json');

    fs.mkdirSync(agentsRoot, { recursive: true });

    process.env.NEXUS_AGENTS_SEED_PATH = agentsRoot;
    process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH = assignmentsPath;
  });

  afterEach(() => {
    delete process.env.NEXUS_AGENTS_SEED_PATH;
    delete process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads valid file-based agent seed definitions', () => {
    const architectDir = path.join(agentsRoot, 'architect-agent');
    fs.mkdirSync(architectDir, { recursive: true });

    fs.writeFileSync(
      path.join(architectDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'architect-agent',
          tier_preference: 'heavy',
          allowed_mount_aliases: ['project_docs'],
          denied_mount_aliases: ['finance_exports'],
          allow_rw_mount_aliases: ['project_docs'],
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              {
                effect: ToolPolicyEffect.ALLOW,
                tool: 'invoke_agent_workflow',
                arguments: { workflow_id: { operator: 'absent' } },
              },
            ],
          },
          assigned_skills: ['software-architect'],
          is_active: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(
      path.join(architectDir, 'PROMPT.md'),
      'You are the architect agent.',
      'utf8',
    );

    const service = new AgentProfilesFileSeedService();

    const result = service.loadDefinitions();

    expect(result.seedRoot).toBe(agentsRoot);
    expect(result.usedLegacyAssignments).toBe(false);
    expect(result.definitions).toEqual([
      {
        name: 'architect-agent',
        system_prompt: 'You are the architect agent.',
        tier_preference: 'heavy',
        allowed_mount_aliases: ['project_docs'],
        denied_mount_aliases: ['finance_exports'],
        allow_rw_mount_aliases: ['project_docs'],
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            {
              effect: ToolPolicyEffect.ALLOW,
              tool: 'invoke_agent_workflow',
              arguments: { workflow_id: { operator: 'absent' } },
            },
          ],
        },
        assigned_skills: ['software-architect'],
        is_active: true,
      },
    ]);
  });

  it('loads hyphenated non-external assistant profile seeds', () => {
    const softwareEngineerDir = path.join(
      agentsRoot,
      'software-engineer-assistant',
    );
    const friendlyAssistantDir = path.join(
      agentsRoot,
      'friendly-general-assistant',
    );

    fs.mkdirSync(softwareEngineerDir, { recursive: true });
    fs.mkdirSync(friendlyAssistantDir, { recursive: true });

    fs.writeFileSync(
      path.join(softwareEngineerDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'software-engineer-assistant',
          tier_preference: 'heavy',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [],
          },
          assigned_skills: ['test-driven-development', 'coding-standards'],
          is_active: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(
      path.join(softwareEngineerDir, 'PROMPT.md'),
      'Software engineer assistant prompt.',
      'utf8',
    );

    fs.writeFileSync(
      path.join(friendlyAssistantDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'friendly-general-assistant',
          tier_preference: 'heavy',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [],
          },
          assigned_skills: ['project-analysis'],
          is_active: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(
      path.join(friendlyAssistantDir, 'PROMPT.md'),
      'Friendly assistant prompt.',
      'utf8',
    );

    const service = new AgentProfilesFileSeedService();
    const result = service.loadDefinitions();
    const names = result.definitions.map((definition) => definition.name);

    expect(names).toContain('software-engineer-assistant');
    expect(names).toContain('friendly-general-assistant');
  });

  it('skips agent seed entries with malformed tool policy documents', () => {
    const architectDir = path.join(agentsRoot, 'architect-agent');
    fs.mkdirSync(architectDir, { recursive: true });

    fs.writeFileSync(
      path.join(architectDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'architect-agent',
          tier_preference: 'heavy',
          tool_policy: { default: 'invalid-effect', rules: [] },
          assigned_skills: [],
          is_active: true,
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(
      path.join(architectDir, 'PROMPT.md'),
      'Prompt content',
      'utf8',
    );

    const service = new AgentProfilesFileSeedService();

    const result = service.loadDefinitions();

    expect(result.definitions).toEqual([]);
  });

  it('falls back to legacy assignment manifest when assigned_skills is omitted', () => {
    const architectDir = path.join(agentsRoot, 'architect-agent');
    fs.mkdirSync(architectDir, { recursive: true });

    fs.writeFileSync(
      path.join(architectDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'architect-agent',
          tier_preference: 'heavy',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [],
          },
          is_active: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(
      path.join(architectDir, 'PROMPT.md'),
      'Prompt content',
      'utf8',
    );

    fs.writeFileSync(
      assignmentsPath,
      JSON.stringify({ 'architect-agent': ['software-architect'] }),
      'utf8',
    );

    const service = new AgentProfilesFileSeedService();

    const result = service.loadDefinitions();

    expect(result.usedLegacyAssignments).toBe(true);
    expect(result.definitions[0]?.assigned_skills).toEqual([
      'software-architect',
    ]);
  });

  it('skips invalid agent seed entries', () => {
    const invalidDir = path.join(agentsRoot, 'architect-agent');
    fs.mkdirSync(invalidDir, { recursive: true });

    fs.writeFileSync(
      path.join(invalidDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'different-name',
          tier_preference: 'heavy',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [],
          },
          assigned_skills: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(path.join(invalidDir, 'PROMPT.md'), 'Prompt', 'utf8');

    const service = new AgentProfilesFileSeedService();

    const result = service.loadDefinitions();

    expect(result.definitions).toHaveLength(0);
    expect(service.hasFileSeedDefinitions()).toBe(false);
  });

  it('skips profiles that reference unknown assigned skills', () => {
    const invalidDir = path.join(agentsRoot, 'architect-agent');
    fs.mkdirSync(invalidDir, { recursive: true });

    fs.writeFileSync(
      path.join(invalidDir, 'agent.json'),
      JSON.stringify(
        {
          name: 'architect-agent',
          tier_preference: 'heavy',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [],
          },
          assigned_skills: ['definitely-missing-skill'],
        },
        null,
        2,
      ),
      'utf8',
    );

    fs.writeFileSync(path.join(invalidDir, 'PROMPT.md'), 'Prompt', 'utf8');

    const service = new AgentProfilesFileSeedService();
    const result = service.loadDefinitions();

    expect(result.definitions).toHaveLength(0);
  });
});
