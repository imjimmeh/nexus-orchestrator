import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolPolicyEffect } from '@nexus/core';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Repository } from 'typeorm';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import { AgentProfileSeedService } from './agent-profiles';
import { AgentProfilesFileSeedService } from './agent-profiles/agent-profiles-file-seed.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';

const agentSeedsDir = resolve(__dirname, '../../../../../seed/agents');

function listAgentSeedConfigFiles(): string[] {
  return readdirSync(agentSeedsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(agentSeedsDir, entry.name, 'agent.json'));
}

function readJsonConfig(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

const FILE_DEFINITIONS = [
  {
    name: 'architect-agent',
    system_prompt: 'Architect seed prompt',
    tier_preference: 'heavy' as const,
    tool_policy: {
      default: ToolPolicyEffect.DENY,
      rules: [
        { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
      ],
    },
    assigned_skills: ['software-architect'],
    is_active: true,
  },
  {
    name: 'product-manager',
    system_prompt: 'Product manager seed prompt',
    tier_preference: 'heavy' as const,
    tool_policy: {
      default: ToolPolicyEffect.DENY,
      rules: [
        { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
      ],
    },
    assigned_skills: ['product-requirements-refinement'],
    is_active: true,
  },
  {
    name: 'ceo-agent',
    system_prompt: 'CEO seed prompt',
    tier_preference: 'heavy' as const,
    tool_policy: {
      default: ToolPolicyEffect.DENY,
      rules: [
        { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
        { effect: ToolPolicyEffect.ALLOW, tool: 'step_complete' },
      ],
    },
    assigned_skills: [],
    is_active: true,
  },
];

function expectAllowedTools(profileName: string, toolNames: string[]): void {
  const service = new AgentProfilesFileSeedService();
  const evaluator = new ToolPolicyEvaluatorService();
  const profile = service
    .loadDefinitions()
    .definitions.find((definition) => definition.name === profileName);

  expect(profile).toBeDefined();
  const policy = profile?.tool_policy;
  if (!policy) {
    throw new Error(`${profileName} tool_policy was not loaded`);
  }

  for (const toolName of toolNames) {
    expect(evaluator.evaluate(toolName, {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
  }
}

describe('AgentProfileSeedService', () => {
  const repository = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    merge: vi.fn((target, source) => ({ ...target, ...source })),
    save: vi.fn(),
  } as unknown as Repository<AgentProfile>;

  const fileSeedService = {
    loadDefinitions: vi.fn(),
  };

  const skillResolver = {
    resolveAssignedSkills: vi.fn(),
    areSkillAssignmentsEqual: vi.fn(),
  };

  let service: AgentProfileSeedService;

  beforeEach(() => {
    vi.clearAllMocks();

    fileSeedService.loadDefinitions.mockReturnValue({
      definitions: FILE_DEFINITIONS,
      seedRoot: '/seed/agents',
      usedLegacyAssignments: false,
    });

    skillResolver.resolveAssignedSkills.mockImplementation(
      (_profileName: string, configured: string[] | undefined) =>
        configured ?? null,
    );

    skillResolver.areSkillAssignmentsEqual.mockImplementation(
      (left: string[] | null | undefined, right: string[] | null | undefined) =>
        JSON.stringify(left ?? []) === JSON.stringify(right ?? []),
    );

    service = new AgentProfileSeedService(
      repository,
      fileSeedService as never,
      skillResolver as never,
    );
  });

  it('creates all file-based agent profiles when none exist', async () => {
    vi.mocked(repository.findOne).mockResolvedValue(null);
    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    expect(repository.save).toHaveBeenCalledTimes(FILE_DEFINITIONS.length);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'architect-agent',
        system_prompt: 'Architect seed prompt',
        model_name: null,
        provider_name: null,
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
        assigned_skills: ['software-architect'],
        source: 'seeded',
        is_active: true,
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ceo-agent',
        system_prompt: 'CEO seed prompt',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'step_complete' },
          ],
        },
      }),
    );
  });

  it('updates an existing profile when seeded data changes', async () => {
    vi.mocked(repository.findOne).mockImplementation((options) => {
      const where = (options?.where ?? {}) as { name?: string };
      if (where.name === 'architect-agent') {
        return Promise.resolve({
          id: 'profile-1',
          name: 'architect-agent',
          system_prompt: 'outdated prompt',
          model_name: 'old-model',
          provider_name: 'old-provider',
          tier_preference: 'light',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' }],
          },
          assigned_skills: ['old-skill'],
          source: 'seeded',
          created_by_profile: null,
          created_by_workflow_run_id: null,
          factory_context: null,
          is_active: false,
        } as AgentProfile);
      }

      return Promise.resolve(null);
    });

    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'profile-1',
        name: 'architect-agent',
        system_prompt: 'Architect seed prompt',
        model_name: null,
        provider_name: null,
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
        assigned_skills: ['software-architect'],
        source: 'seeded',
        is_active: true,
      }),
    );
  });

  it('skips updates when profile data and assigned skills are unchanged', async () => {
    vi.mocked(repository.findOne).mockImplementation((options) => {
      const where = (options?.where ?? {}) as { name?: string };
      if (where.name !== 'architect-agent') {
        return Promise.resolve(null);
      }

      return Promise.resolve({
        id: 'profile-1',
        name: 'architect-agent',
        system_prompt: 'Architect seed prompt',
        model_name: null,
        provider_name: null,
        tier_preference: 'heavy',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [
            { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
            { effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' },
          ],
        },
        assigned_skills: ['software-architect'],
        source: 'seeded',
        created_by_profile: null,
        created_by_workflow_run_id: null,
        factory_context: null,
        is_active: true,
      } as AgentProfile);
    });

    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    const architectSaves = vi
      .mocked(repository.save)
      .mock.calls.filter(
        (call) => (call[0] as AgentProfile).name === 'architect-agent',
      );

    expect(architectSaves).toHaveLength(0);
  });

  it('does not seed when file-based definitions are unavailable', async () => {
    fileSeedService.loadDefinitions.mockReturnValue({
      definitions: [],
      seedRoot: null,
      usedLegacyAssignments: false,
    });

    await service.seed();

    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('uses skill resolver output for assigned_skills', async () => {
    fileSeedService.loadDefinitions.mockReturnValue({
      definitions: [
        {
          name: 'custom-agent',
          system_prompt: 'Custom prompt',
          tier_preference: 'light',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
          },
          assigned_skills: ['software-architect', 'missing-skill'],
          is_active: false,
        },
      ],
      seedRoot: '/seed/agents',
      usedLegacyAssignments: false,
    });

    skillResolver.resolveAssignedSkills.mockReturnValue(['software-architect']);
    vi.mocked(repository.findOne).mockResolvedValue(null);
    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'custom-agent',
        assigned_skills: ['software-architect'],
        is_active: false,
      }),
    );
  });

  it('uses per-agent model_name and provider_name from seed file when defined', async () => {
    fileSeedService.loadDefinitions.mockReturnValue({
      definitions: [
        {
          name: 'custom-agent',
          system_prompt: 'Custom prompt',
          tier_preference: 'light',
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
          },
          assigned_skills: [],
          model_name: 'custom-model',
          provider_name: 'custom-provider',
          is_active: true,
        },
      ],
      seedRoot: '/seed/agents',
      usedLegacyAssignments: false,
    });

    vi.mocked(repository.findOne).mockResolvedValue(null);
    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'custom-agent',
        model_name: 'custom-model',
        provider_name: 'custom-provider',
      }),
    );
  });

  it('leaves model_name and provider_name null when seed file omits them', async () => {
    vi.mocked(repository.findOne).mockResolvedValue(null);
    (repository.save as any).mockResolvedValue(undefined);

    await service.seed();

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'architect-agent',
        model_name: null,
        provider_name: null,
      }),
    );
  });

  it('loads the constrained sysadmin repair profile seed', () => {
    const service = new AgentProfilesFileSeedService();
    const result = service.loadDefinitions();
    const profile = result.definitions.find(
      (definition) => definition.name === 'sysadmin-repair',
    );

    expect(profile).toBeDefined();
    expect(profile).toEqual(
      expect.objectContaining({
        name: 'sysadmin-repair',
        tier_preference: 'heavy',
        assigned_skills: [],
        is_active: true,
      }),
    );
    expect(profile?.tool_policy).toEqual({
      default: ToolPolicyEffect.DENY,
      rules: expect.arrayContaining([
        'deny step_complete *',
        'deny spawn_subagent_async *',
        'deny submit_qa_decision *',
        'allow read *',
        'allow bash *',
        'allow write *',
        'allow edit *',
        'allow set_job_output *',
      ]),
    });

    const evaluator = new ToolPolicyEvaluatorService();
    const policy = profile?.tool_policy;
    if (!policy) {
      throw new Error('sysadmin-repair tool_policy was not loaded');
    }
    expect(evaluator.evaluate('read', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('search_skills', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('ls', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('bash', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('write', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('edit', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('set_job_output', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );

    expect(evaluator.evaluate('step_complete', {}, policy).effect).toBe(
      ToolPolicyEffect.DENY,
    );
    expect(evaluator.evaluate('spawn_subagent_async', {}, policy).effect).toBe(
      ToolPolicyEffect.DENY,
    );
    expect(evaluator.evaluate('submit_qa_decision', {}, policy).effect).toBe(
      ToolPolicyEffect.DENY,
    );

    expect(profile?.system_prompt).toContain(
      'Do not read, print, create, modify, or infer secrets or credentials.',
    );
    expect(profile?.system_prompt).toContain(
      'Do not run destructive git operations',
    );
    expect(profile?.system_prompt).toContain(
      'Do not make broad refactors or unrelated code changes.',
    );
    expect(profile?.system_prompt).toContain(
      'Always call `set_job_output` once with `status`, `summary`, `changes`, and `verification`.',
    );
  });

  it('loads the investigation-coordinator profile from file seeds', () => {
    const service = new AgentProfilesFileSeedService();
    const result = service.loadDefinitions();
    const profile = result.definitions.find(
      (definition) => definition.name === 'investigation-coordinator',
    );

    expect(profile).toBeDefined();
    const evaluator = new ToolPolicyEvaluatorService();
    const policy = profile?.tool_policy;
    if (!policy) {
      throw new Error('investigation-coordinator tool_policy was not loaded');
    }
    expect(evaluator.evaluate('read', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('search_skills', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('spawn_subagent_async', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('set_job_output', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('step_complete', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
  });

  it('loads the ceo-agent profile with default-deny durable delegation policy', () => {
    const service = new AgentProfilesFileSeedService();
    const evaluator = new ToolPolicyEvaluatorService();
    const result = service.loadDefinitions();
    const profile = result.definitions.find(
      (definition) => definition.name === 'ceo-agent',
    );
    const policy = profile?.tool_policy;
    if (!policy) {
      throw new Error('ceo-agent tool_policy was not loaded');
    }

    // The CEO drives orchestration by invoking and durably awaiting child
    // workflows, so both primitives are explicitly granted on a default-deny base.
    expect(policy.default).toBe(ToolPolicyEffect.DENY);
    expect(policy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effect: ToolPolicyEffect.ALLOW,
          tool: 'invoke_agent_workflow',
        }),
        expect.objectContaining({
          effect: ToolPolicyEffect.ALLOW,
          tool: 'await_agent_workflow',
        }),
      ]),
    );
    expect(evaluator.evaluate('invoke_agent_workflow', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('await_agent_workflow', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('read', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
  });

  it('grants search_skills to every active seeded agent', () => {
    const service = new AgentProfilesFileSeedService();
    const evaluator = new ToolPolicyEvaluatorService();
    const result = service.loadDefinitions();
    const activeAgents = result.definitions.filter(
      (agent) => agent.is_active !== false,
    );

    expect(activeAgents.length).toBeGreaterThan(0);

    for (const agent of activeAgents) {
      const policy = agent.tool_policy;
      if (!policy) {
        throw new Error(`Agent ${agent.name} tool_policy is missing`);
      }
      expect(evaluator.evaluate('search_skills', {}, policy).effect).toBe(
        ToolPolicyEffect.ALLOW,
      );
    }
  });

  it('does not mix legacy tool arrays with tool_policy in agent seed files', () => {
    const duplicatePolicyFiles = listAgentSeedConfigFiles()
      .map((filePath) => ({ filePath, config: readJsonConfig(filePath) }))
      .filter(({ config }) => config.tool_policy !== undefined)
      .filter(
        ({ config }) =>
          config.allowed_tools !== undefined ||
          config.denied_tools !== undefined ||
          config.approval_required_tools !== undefined,
      )
      .map(({ filePath }) => filePath.replace(agentSeedsDir, 'seed/agents'));

    expect(duplicatePolicyFiles).toEqual([]);
  });

  it('product_manager_ingestion profile exists with PRD authoring tools', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find(
      (d) => d.name === 'product_manager_ingestion',
    );
    expect(profile).toBeDefined();
    const rules = profile!.tool_policy?.rules ?? [];
    const ruleStrings = rules.map((r) =>
      typeof r === 'string' ? r : `${r.effect} ${r.tool}`,
    );
    expect(ruleStrings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('read_document'),
        expect.stringContaining('create_artifact'),
      ]),
    );
    expect(profile!.tool_policy?.rules.length).toBeGreaterThanOrEqual(3);
    expect(profile!.assigned_skills).toEqual(
      expect.arrayContaining(['prd-authoring']),
    );
  });

  it('technical_architect_ingestion profile exists with SDD authoring tools', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find(
      (d) => d.name === 'technical_architect_ingestion',
    );
    expect(profile).toBeDefined();
    expect(profile!.assigned_skills).toEqual(
      expect.arrayContaining(['sdd-authoring', 'architecture-design']),
    );
  });

  it('ingestion_runner profile exists with file management tools', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find(
      (d) => d.name === 'ingestion_runner',
    );
    expect(profile).toBeDefined();
    expect(profile!.tier_preference).toBe('light');
    const rules = profile!.tool_policy?.rules ?? [];
    const ruleStrings = rules.map((r) =>
      typeof r === 'string' ? r : `${r.effect} ${r.tool}`,
    );
    expect(ruleStrings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('create_artifact'),
        expect.stringContaining('bash'),
      ]),
    );
  });

  it('skill-author profile allows update_skill', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find((d) => d.name === 'skill-author');

    expect(profile).toBeDefined();
    const evaluator = new ToolPolicyEvaluatorService();
    const policy = profile?.tool_policy;
    if (!policy) {
      throw new Error('skill-author tool_policy was not loaded');
    }

    expect(evaluator.evaluate('create_skill', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
    expect(evaluator.evaluate('update_skill', {}, policy).effect).toBe(
      ToolPolicyEffect.ALLOW,
    );
  });

  it('git_verifier profile exists with bash tool access', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find((d) => d.name === 'git_verifier');
    expect(profile).toBeDefined();
    expect(profile!.tier_preference).toBe('light');
    const rules = profile!.tool_policy?.rules ?? [];
    const ruleStrings = rules.map((r) =>
      typeof r === 'string' ? r : `${r.effect} ${r.tool}`,
    );
    expect(ruleStrings).toEqual(
      expect.arrayContaining([expect.stringContaining('bash')]),
    );
  });

  it('requirements_extractor profile exists with document tools', () => {
    const svc = new AgentProfilesFileSeedService();
    const result = svc.loadDefinitions();
    const profile = result.definitions.find(
      (d) => d.name === 'requirements_extractor',
    );
    expect(profile).toBeDefined();
    expect(profile!.tier_preference).toBe('heavy');
    const rules = profile!.tool_policy?.rules ?? [];
    const ruleStrings = rules.map((r) =>
      typeof r === 'string' ? r : `${r.effect} ${r.tool}`,
    );
    expect(ruleStrings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('read_document'),
        expect.stringContaining('fetch_url'),
        expect.stringContaining('create_artifact'),
      ]),
    );
    expect(profile!.assigned_skills).toEqual(
      expect.arrayContaining(['document-parsing', 'requirement-elicitation']),
    );
  });

  describe('design-analyst agent profile seed', () => {
    it('design-analyst has all ingestion tool permissions', () => {
      const service = new AgentProfilesFileSeedService();
      const result = service.loadDefinitions();
      const profile = result.definitions.find(
        (d) => d.name === 'design-analyst',
      );

      expect(profile).toBeDefined();
      const rules = profile?.tool_policy?.rules ?? [];
      const ruleStrings = rules.map((r) =>
        typeof r === 'string' ? r : `${r.effect} ${r.tool}`,
      );

      expect(ruleStrings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('fetch_url'),
          expect.stringContaining('read_document'),
          expect.stringContaining('analyze_image'),
          expect.stringContaining('extract_figma'),
          expect.stringContaining('create_artifact'),
        ]),
      );
    });

    it('design-analyst has supports_vision: true', () => {
      const service = new AgentProfilesFileSeedService();
      const result = service.loadDefinitions();
      const profile = result.definitions.find(
        (d) => d.name === 'design-analyst',
      );
      expect(profile?.supports_vision).toBe(true);
    });
  });

  it('loads the ui-ux-tester profile with browser and completion tools', () => {
    const service = new AgentProfilesFileSeedService();
    const evaluator = new ToolPolicyEvaluatorService();
    const profile = service
      .loadDefinitions()
      .definitions.find((definition) => definition.name === 'ui-ux-tester');

    expect(profile).toBeDefined();
    expect(profile?.tier_preference).toBe('heavy');
    expect(profile?.is_active).toBe(true);
    expect(profile?.tool_policy?.default).toBe(ToolPolicyEffect.DENY);

    for (const tool of [
      'bash',
      'browser_open_page',
      'browser_click',
      'browser_read_page',
      'browser_screenshot',
      'set_job_output',
      'step_complete',
    ]) {
      expect(evaluator.evaluate(tool, {}, profile!.tool_policy).effect).toBe(
        ToolPolicyEffect.ALLOW,
      );
    }
  });

  it('loads the web-researcher profile with governed web tools', () => {
    const service = new AgentProfilesFileSeedService();
    const evaluator = new ToolPolicyEvaluatorService();
    const profile = service
      .loadDefinitions()
      .definitions.find((definition) => definition.name === 'web-researcher');

    expect(profile).toBeDefined();
    expect(profile?.tier_preference).toBe('heavy');
    expect(profile?.tool_policy?.default).toBe(ToolPolicyEffect.DENY);

    for (const tool of [
      'web_search',
      'web_fetch',
      'browser_open_page',
      'browser_read_page',
      'create_artifact',
      'set_job_output',
      'step_complete',
    ]) {
      expect(evaluator.evaluate(tool, {}, profile!.tool_policy).effect).toBe(
        ToolPolicyEffect.ALLOW,
      );
    }
  });

  it('grants specialist delegation tools to caller profiles that need manual digressions', () => {
    expectAllowedTools('qa_automation', [
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]);
    expectAllowedTools('senior_dev', [
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]);
    expectAllowedTools('orchestrator', [
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]);
    expectAllowedTools('architect-agent', [
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]);
    expectAllowedTools('product-manager', ['delegate_web_research']);
    expectAllowedTools('ceo-agent', [
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]);
  });

  it('every assigned skill resolves to a real seed/skills directory', () => {
    const service = new AgentProfilesFileSeedService();
    const skillsRoot = resolve(__dirname, '../../../../../seed/skills');
    const { definitions } = service.loadDefinitions();

    const missing: string[] = [];
    for (const agent of definitions.filter((a) => a.is_active !== false)) {
      for (const skill of agent.assigned_skills ?? []) {
        if (!existsSync(join(skillsRoot, skill, 'SKILL.md'))) {
          missing.push(`${agent.name} -> ${skill}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('every raw agent.json assigned_skills entry has a real seed/skills/<name>/SKILL.md (catches dangling refs even when loadDefinitions drops the agent)', () => {
    const skillsRoot = resolve(__dirname, '../../../../../seed/skills');
    const agentJsonFiles = listAgentSeedConfigFiles().filter((f) =>
      existsSync(f),
    );

    const missing: string[] = [];
    for (const filePath of agentJsonFiles) {
      const config = readJsonConfig(filePath);
      const agentName = (config.name as string | undefined) ?? filePath;
      const assignedSkills = config.assigned_skills as string[] | undefined;
      if (!Array.isArray(assignedSkills)) {
        continue;
      }
      for (const skill of assignedSkills) {
        if (!existsSync(join(skillsRoot, skill, 'SKILL.md'))) {
          missing.push(`${agentName} -> ${skill}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
