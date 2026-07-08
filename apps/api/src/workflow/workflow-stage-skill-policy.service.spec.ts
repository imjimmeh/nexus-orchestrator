import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';
import type { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import type { SystemSettingsService } from '../settings/system-settings.service';
import { WorkflowStageSkillPolicyService } from './workflow-stage-skill-policy.service';

describe('WorkflowStageSkillPolicyService', () => {
  let service: WorkflowStageSkillPolicyService;

  const listSkillsByProfileNameMock = vi.fn();
  const listSkillsMock = vi.fn();
  const listSkillsForScopeMock = vi.fn();
  const listApplicableSkillNamesMock = vi.fn();
  const settingsGetMock = vi.fn();

  const architectureSkill: SkillLibraryRecord = {
    id: 'architecture-review',
    name: 'architecture-review',
    description: 'Review architecture constraints',
    skillMarkdown: `---
  name: architecture-review
  description: Review architecture constraints
  ---
  `,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    version: 1,
    source: 'admin',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    rootPath: '/tmp/architecture-review',
    isActive: true,
  };

  const testSkill: SkillLibraryRecord = {
    id: 'test-planning',
    name: 'test-planning',
    description: 'Plan and execute tests',
    skillMarkdown: `---
  name: test-planning
  description: Plan and execute tests
  ---
  `,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    version: 1,
    source: 'admin',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    rootPath: '/tmp/test-planning',
    isActive: true,
  };

  const documentationSkill: SkillLibraryRecord = {
    id: 'documentation-writer',
    name: 'documentation-writer',
    description: 'Write docs and runbooks',
    skillMarkdown: `---
  name: documentation-writer
  description: Write docs and runbooks
  ---
  `,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    version: 1,
    source: 'admin',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    rootPath: '/tmp/documentation-writer',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listSkillsForScopeMock.mockResolvedValue([]);

    const agentSkills = {
      listSkillsByProfileName: listSkillsByProfileNameMock,
      listSkills: listSkillsMock,
      listSkillsForScope: listSkillsForScopeMock,
    } as unknown as AgentSkillsService;

    const settings = {
      get: settingsGetMock,
    } as unknown as SystemSettingsService;

    listSkillsByProfileNameMock.mockResolvedValue([
      architectureSkill,
      testSkill,
    ]);
    listSkillsMock.mockReturnValue([
      architectureSkill,
      testSkill,
      documentationSkill,
    ]);
    settingsGetMock.mockResolvedValue({});
    listApplicableSkillNamesMock.mockResolvedValue([]);

    const profileSkillBindings = {
      listApplicableSkillNames: listApplicableSkillNamesMock,
    } as unknown as AgentProfileSkillBindingService;

    service = new WorkflowStageSkillPolicyService(
      agentSkills,
      settings,
      profileSkillBindings,
    );
  });

  it('resolves implementation stage from explicit generic lifecycle fields', () => {
    const stage = service.resolveLifecycleStage({
      lifecycle_stage: 'implementation',
    });

    expect(stage).toBe('implementation');
  });

  it('resolves implementation stage from dispatch_target_stage field', () => {
    const stage = service.resolveLifecycleStage({
      trigger: {
        dispatch_target_stage: 'implementation',
      },
    });

    expect(stage).toBe('implementation');
  });

  it('returns profile-only skills when no stage policy matches', async () => {
    const selection = await service.resolveAssignedSkills({
      agentProfile: 'ceo-agent',
      workflowStage: 'review',
    });

    expect(selection.policySource).toBe('profile');
    expect(selection.policyMatched).toBe(false);
    expect(selection.missingOrInvalidPolicy).toBe(true);
    expect(selection.skills.map((skill) => skill.name)).toEqual([
      'architecture-review',
      'test-planning',
    ]);
  });

  it('applies stage policy without profile fallback when configured', async () => {
    settingsGetMock.mockResolvedValue({
      review: {
        'ceo-agent': {
          include_skills: ['documentation-writer'],
          fallback_to_profile_skills: false,
        },
      },
    });

    const selection = await service.resolveAssignedSkills({
      agentProfile: 'ceo-agent',
      workflowStage: 'review',
    });

    expect(selection.policySource).toBe('stage_policy');
    expect(selection.fallbackToProfileSkills).toBe(false);
    expect(selection.policyMatched).toBe(true);
    expect(selection.skills.map((skill) => skill.name)).toEqual([
      'documentation-writer',
    ]);
  });

  it('applies stage policy with profile fallback and exclusions', async () => {
    settingsGetMock.mockResolvedValue({
      implementation: {
        'ceo-agent': {
          include_skills: ['documentation-writer'],
          exclude_skills: ['test-planning'],
          fallback_to_profile_skills: true,
        },
      },
    });

    const selection = await service.resolveAssignedSkills({
      agentProfile: 'ceo-agent',
      workflowStage: 'implementation',
    });

    expect(selection.policySource).toBe('stage_policy_with_profile_fallback');
    expect(selection.fallbackToProfileSkills).toBe(true);
    expect(selection.policyMatched).toBe(true);
    expect(selection.skills.map((skill) => skill.name)).toEqual([
      'architecture-review',
      'documentation-writer',
    ]);
    expect(selection.includedSkillNames).toEqual(['documentation-writer']);
    expect(selection.excludedSkillNames).toEqual(['test-planning']);
  });

  it('reports invalid policy and falls back to profile skills safely', async () => {
    settingsGetMock.mockResolvedValue({
      implementation: {
        'ceo-agent': {
          include_skills: 'documentation-writer',
        },
      },
    });

    const selection = await service.resolveAssignedSkills({
      agentProfile: 'ceo-agent',
      workflowStage: 'implementation',
    });

    expect(selection.policySource).toBe('invalid_policy');
    expect(selection.policyMatched).toBe(false);
    expect(selection.missingOrInvalidPolicy).toBe(true);
    expect(selection.skills.map((skill) => skill.name)).toEqual([
      'architecture-review',
      'test-planning',
    ]);
  });

  describe('scope union', () => {
    const projectSkill: SkillLibraryRecord = {
      id: 'project-skill',
      name: 'project-skill',
      description: 'Project-scoped skill',
      skillMarkdown: '---\nname: project-skill\ndescription: d\n---\n',
      compatibility: null,
      category: null,
      tags: [],
      metadata: null,
      scope: { projects: ['scope-123'], agents: [], workflows: [] },
      version: 1,
      source: 'imported',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      rootPath: '/tmp/project-skill',
      isActive: true,
    };

    it('includes scope-matched skills alongside global assigned skills', async () => {
      listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
      listSkillsForScopeMock.mockResolvedValue([projectSkill]);

      const selection = await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
      });

      const names = selection.skills.map((s) => s.name).sort();
      expect(names).toEqual(['architecture-review', 'project-skill']);
      expect(listSkillsForScopeMock).toHaveBeenCalledWith({
        scopeId: 'scope-123',
        agentProfile: 'software-architect',
        workflowId: undefined,
      });
    });

    it('excludes an assigned skill that is itself scoped to a non-matching context', async () => {
      const scopedAssigned: SkillLibraryRecord = {
        ...projectSkill,
        id: 'scoped-assigned',
        name: 'scoped-assigned',
        scope: { projects: ['other-scope'], agents: [], workflows: [] },
      };
      listSkillsByProfileNameMock.mockResolvedValue([
        architectureSkill,
        scopedAssigned,
      ]);
      listSkillsForScopeMock.mockResolvedValue([]);

      const selection = await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
      });

      expect(selection.skills.map((s) => s.name)).toEqual([
        'architecture-review',
      ]);
    });

    it('scoped variant wins when a skill name appears in both global and scoped sets', async () => {
      const globalVersion: SkillLibraryRecord = {
        ...projectSkill,
        id: 'project-skill-global',
        name: 'project-skill',
        scope: null,
        description: 'Global version',
      };
      const scopedVersion: SkillLibraryRecord = {
        ...projectSkill,
        description: 'Scoped version',
      };
      listSkillsByProfileNameMock.mockResolvedValue([globalVersion]);
      listSkillsForScopeMock.mockResolvedValue([scopedVersion]);

      const selection = await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
      });

      const found = selection.skills.find((s) => s.name === 'project-skill');
      expect(found?.description).toBe('Scoped version');
      expect(selection.skills).toHaveLength(1);
    });

    it('forwards workflowId to listSkillsForScope', async () => {
      listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
      listSkillsForScopeMock.mockResolvedValue([]);

      await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        workflowId: 'workflow-abc',
      });

      expect(listSkillsForScopeMock).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'workflow-abc' }),
      );
    });

    it('includes a scope-node binding skill alongside global and frontmatter-scoped skills', async () => {
      const boundSkill: SkillLibraryRecord = {
        ...projectSkill,
        id: 'bound-skill',
        name: 'bound-skill',
        scope: null,
      };
      listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
      listSkillsForScopeMock.mockResolvedValue([]);
      listSkillsMock.mockReturnValue([
        architectureSkill,
        testSkill,
        documentationSkill,
        boundSkill,
      ]);
      listApplicableSkillNamesMock.mockResolvedValue(['bound-skill']);

      const selection = await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
      });

      const names = selection.skills.map((s) => s.name).sort();
      expect(names).toEqual(['architecture-review', 'bound-skill']);
      expect(listApplicableSkillNamesMock).toHaveBeenCalledWith({
        scopeNodeId: 'scope-123',
        agentProfileName: 'software-architect',
      });
    });

    it('does not query bindings when no scopeId is given', async () => {
      listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
      listSkillsForScopeMock.mockResolvedValue([]);

      await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
      });

      expect(listApplicableSkillNamesMock).toHaveBeenCalledWith({
        scopeNodeId: undefined,
        agentProfileName: 'software-architect',
      });
    });

    it('matches bound skill names despite case/separator differences in the DB binding', async () => {
      const boundSkill: SkillLibraryRecord = {
        ...projectSkill,
        id: 'my-test-skill',
        name: 'my-test-skill',
        scope: null,
      };
      listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
      listSkillsForScopeMock.mockResolvedValue([]);
      listSkillsMock.mockReturnValue([
        architectureSkill,
        testSkill,
        documentationSkill,
        boundSkill,
      ]);
      listApplicableSkillNamesMock.mockResolvedValue(['My_Test_Skill']);

      const selection = await service.resolveAssignedSkills({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
      });

      const names = selection.skills.map((s) => s.name).sort();
      expect(names).toEqual(['architecture-review', 'my-test-skill']);
    });
  });
});
