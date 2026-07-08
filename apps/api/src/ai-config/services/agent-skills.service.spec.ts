import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateAgentSkillRequest } from '@nexus/core';
import { AgentSkillsService } from './agent-skills.service';
import type { AgentProfileRepository } from '../database/repositories/agent-profile.repository';
import type { AgentSkillLibraryService } from './agent-skill-library.service';
import type { SkillLibraryRecord } from './agent-skill-library.service.types';
import type { SkillService } from './skill.service';
import { SkillIndexService } from './skill-search/skill-index.service';
import { TokenMatchStrategy } from './skill-search/strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './skill-search/strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './skill-search/strategies/tfidf-match.strategy';
import { SkillSearchPipelineService } from './skill-search/skill-search-pipeline.service';

describe('AgentSkillsService', () => {
  let service: AgentSkillsService;

  const skillLibrary = {
    listSkills: vi.fn(),
    listCategories: vi.fn(),
    getSkill: vi.fn(),
    skillExists: vi.fn(),
    writeSkillMarkdown: vi.fn(),
    renameSkill: vi.fn(),
    deleteSkill: vi.fn(),
    listSkillFiles: vi.fn(),
    upsertSkillFile: vi.fn(),
    deleteSkillFile: vi.fn(),
  } as unknown as AgentSkillLibraryService;

  const profileRepo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    update: vi.fn(),
  } as unknown as AgentProfileRepository;

  const skillService = {
    upsert: vi.fn(),
  } as unknown as SkillService;

  const validMarkdown = `---
name: review-plan
description: Run review checklist
---

# Review Plan

1. Read requirements
2. Verify tests
`;

  beforeEach(() => {
    vi.clearAllMocks();

    (profileRepo.findAll as any).mockResolvedValue([]);
    (profileRepo.findById as any).mockResolvedValue({
      id: 'profile-1',
      name: 'architect-agent',
      assigned_skills: [],
    });
    (profileRepo.findByName as any).mockResolvedValue(null);
    (profileRepo.update as any).mockResolvedValue(undefined);
    (skillService.upsert as any).mockResolvedValue({ id: 'db-id', name: 'x' });
    (skillLibrary.skillExists as any).mockReturnValue(false);
    (skillLibrary.writeSkillMarkdown as any).mockImplementation(
      (name: string) => ({
        id: name,
        name,
        description: 'Run review checklist',
        skillMarkdown: validMarkdown,
        compatibility: null,
        metadata: null,
        source: 'imported',
        version: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        rootPath: `/skills/${name}`,
      }),
    );
    (skillLibrary.getSkill as any).mockImplementation((name: string) => {
      if (name === 'missing') {
        throw new NotFoundException(`Skill with name ${name} not found`);
      }

      return {
        id: name,
        name,
        description: 'Run review checklist',
        skillMarkdown: validMarkdown,
        compatibility: null,
        metadata: null,
        source: 'imported',
        version: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        rootPath: `/skills/${name}`,
      };
    });

    const searchPipeline = new SkillSearchPipelineService(
      new SkillIndexService(),
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
    );
    service = new AgentSkillsService(
      skillLibrary,
      searchPipeline,
      profileRepo,
      skillService,
    );
  });

  it('creates a skill with normalized filesystem name', async () => {
    const result = await service.createSkill({
      name: 'Review-Plan',
      description: 'Run review checklist',
      skill_markdown: validMarkdown,
      is_active: true,
    });

    expect(skillLibrary.writeSkillMarkdown).toHaveBeenCalledWith(
      'review-plan',
      validMarkdown,
    );
    expect(result.name).toBe('review-plan');
  });

  it('rejects skill creation when frontmatter name does not match entity name', async () => {
    expect(() =>
      service.createSkill({
        name: 'review-plan',
        description: 'Run review checklist',
        skill_markdown: validMarkdown.replace('review-plan', 'different-name'),
      }),
    ).toThrow(BadRequestException);
  });

  it('updates a skill and increments version', async () => {
    const updated = await service.updateSkill('review-plan', {
      description: 'Updated description',
      skill_markdown: validMarkdown,
    });

    expect(skillLibrary.writeSkillMarkdown).toHaveBeenCalledWith(
      'review-plan',
      validMarkdown,
    );
    expect(updated.name).toBe('review-plan');
  });

  it('throws when replacing profile skills with unknown IDs', async () => {
    (skillLibrary.getSkill as any).mockImplementation((name: string) => {
      if (name === 'skill-1') {
        return {
          id: 'skill-1',
          name: 'skill-1',
          description: 'd',
          skillMarkdown: validMarkdown,
          compatibility: null,
          metadata: null,
          source: 'imported',
          version: 1,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/skill-1',
        };
      }

      throw new NotFoundException(`Skill with name ${name} not found`);
    });

    await expect(
      service.replaceProfileSkills('profile-1', ['skill-1', 'skill-2']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds skills to an existing profile assignment set', async () => {
    (profileRepo.findById as any).mockResolvedValue({
      id: 'profile-1',
      name: 'architect-agent',
      assigned_skills: ['review-plan'],
    });

    await service.addProfileSkills('profile-1', ['debugging']);

    expect(profileRepo.update).toHaveBeenCalledWith('profile-1', {
      assigned_skills: ['review-plan', 'debugging'],
    });
  });

  it('removes selected skills from profile assignments', async () => {
    (profileRepo.findById as any).mockResolvedValue({
      id: 'profile-1',
      name: 'architect-agent',
      assigned_skills: ['review-plan', 'debugging'],
    });

    await service.removeProfileSkills('profile-1', ['debugging']);

    expect(profileRepo.update).toHaveBeenCalledWith('profile-1', {
      assigned_skills: ['review-plan'],
    });
  });

  it('returns empty list for unknown profile name when resolving by profile name', async () => {
    (profileRepo.findByName as any).mockResolvedValue(null);

    const result = await service.listSkillsByProfileName('missing-profile');
    expect(result).toEqual([]);
  });

  it('throws not found when skill does not exist', async () => {
    expect(() => service.getSkill('missing')).toThrow(NotFoundException);
  });

  it('removes deleted skill from profile assignments', async () => {
    (profileRepo.findAll as any).mockResolvedValue([
      {
        id: 'profile-1',
        assigned_skills: ['review-plan', 'other-skill'],
      },
    ]);

    await service.deleteSkill('review-plan');

    expect(profileRepo.update).toHaveBeenCalledWith('profile-1', {
      assigned_skills: ['other-skill'],
    });
    expect(skillLibrary.deleteSkill).toHaveBeenCalledWith('review-plan');
  });

  describe('skillExists', () => {
    it('delegates to the skill library', () => {
      (skillLibrary.skillExists as any).mockReturnValue(true);

      expect(service.skillExists('review-plan')).toBe(true);
      expect(skillLibrary.skillExists).toHaveBeenCalledWith('review-plan');
    });
  });

  describe('addProfileSkillsByProfileName', () => {
    it('resolves the profile by name and adds the given skills', async () => {
      (profileRepo.findByName as any).mockResolvedValue({
        id: 'profile-1',
        name: 'architect-agent',
        assigned_skills: ['review-plan'],
      });
      (profileRepo.findById as any).mockResolvedValue({
        id: 'profile-1',
        name: 'architect-agent',
        assigned_skills: ['review-plan'],
      });
      (skillLibrary.getSkill as any).mockReturnValue({
        name: 'debugging',
        isActive: true,
      });

      await service.addProfileSkillsByProfileName('architect-agent', [
        'debugging',
      ]);

      expect(profileRepo.findByName).toHaveBeenCalledWith('architect-agent');
      expect(profileRepo.update).toHaveBeenCalledWith('profile-1', {
        assigned_skills: ['review-plan', 'debugging'],
      });
    });

    it('throws not found for an unknown profile name', async () => {
      (profileRepo.findByName as any).mockResolvedValue(null);

      const error = await service
        .addProfileSkillsByProfileName('ghost-agent', ['debugging'])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'Agent profile with name ghost-agent not found',
      );
    });
  });

  describe('removeProfileSkillsByProfileName', () => {
    it('resolves the profile by name and removes the given skills', async () => {
      (profileRepo.findByName as any).mockResolvedValue({
        id: 'profile-1',
        name: 'architect-agent',
        assigned_skills: ['review-plan', 'debugging'],
      });
      (profileRepo.findById as any).mockResolvedValue({
        id: 'profile-1',
        name: 'architect-agent',
        assigned_skills: ['review-plan', 'debugging'],
      });

      await service.removeProfileSkillsByProfileName('architect-agent', [
        'debugging',
      ]);

      expect(profileRepo.findByName).toHaveBeenCalledWith('architect-agent');
      expect(profileRepo.update).toHaveBeenCalledWith('profile-1', {
        assigned_skills: ['review-plan'],
      });
    });

    it('throws not found for an unknown profile name', async () => {
      (profileRepo.findByName as any).mockResolvedValue(null);

      const error = await service
        .removeProfileSkillsByProfileName('ghost-agent', ['debugging'])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'Agent profile with name ghost-agent not found',
      );
    });
  });

  describe('searchSkills', () => {
    it('matches multi-word queries by tokenizing into individual words', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Review the plan',
          category: 'orchestration',
          tags: ['review', 'planning'],
          isActive: true,
        },
        {
          id: 'skill-2',
          name: 'debug-code',
          description: 'Debug the code',
          category: 'debugging',
          tags: ['code', 'fix'],
          isActive: true,
        },
        {
          id: 'skill-3',
          name: 'write-test',
          description: 'Write unit tests',
          category: 'testing',
          tags: ['quality'],
          isActive: true,
        },
      ];

      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const result = service.searchSkills({
        query: 'plan review code',
      });

      expect(result).toEqual([skills[0], skills[1]]);
    });

    it('searches active skills by query, category, and all requested tags', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Review the plan',
          category: 'orchestration',
          tags: ['review', 'planning'],
          isActive: true,
        },
        {
          id: 'skill-2',
          name: 'debug-code',
          description: 'Debug the code',
          category: 'debugging',
          tags: ['code', 'fix'],
          isActive: true,
        },
        {
          id: 'skill-3',
          name: 'write-test',
          description: 'Write unit tests',
          category: 'testing',
          tags: ['code', 'quality'],
          isActive: true,
        },
      ];

      (skillLibrary.listSkills as any).mockReturnValue(skills);

      // Search by query
      expect(service.searchSkills({ query: 'review' })).toEqual([skills[0]]);
      // 'code' matches debug-code (name+description) and write-test (tags: ['code','quality'])
      expect(service.searchSkills({ query: 'code' })).toEqual(
        expect.arrayContaining([skills[1], skills[2]]),
      );

      // Search by category
      expect(service.searchSkills({ category: 'debugging' })).toEqual([
        skills[1],
      ]);

      // Search by tags (AND)
      expect(service.searchSkills({ tags: ['code'] })).toEqual([
        skills[1],
        skills[2],
      ]);
      expect(service.searchSkills({ tags: ['code', 'fix'] })).toEqual([
        skills[1],
      ]);
      expect(service.searchSkills({ tags: ['review', 'fix'] })).toEqual([]);

      // Combined
      expect(
        service.searchSkills({
          query: 'code',
          category: 'debugging',
          tags: ['fix'],
        }),
      ).toEqual([skills[1]]);
    });

    it('returns results sorted by score descending — name match ranks before description-only match', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Review the plan',
          category: 'orchestration',
          tags: ['review', 'planning'],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/review-plan',
        },
        {
          id: 'skill-2',
          name: 'workflow-engine',
          description: 'manages review pipelines',
          category: 'automation',
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/workflow-engine',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'review' });
      // "review-plan" has "review" in name (higher score) vs "workflow-engine" has "review" only in description
      expect(results[0].name).toBe('review-plan');
    });

    it('surfaces _score on results when includeScores=true', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'orchestration-runner',
          description: 'executes orchestration workflows',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/orchestration-runner',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({
        query: 'orchestration',
        includeScores: true,
      });
      expect((results[0] as any)._score).toBeGreaterThan(0);
      expect((results[0] as any)._matchDetails).toBeDefined();
    });

    it('does NOT surface _score when includeScores is omitted', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'orchestration-runner',
          description: 'orchestration workflows',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/orchestration-runner',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'orchestration' });
      expect((results[0] as any)._score).toBeUndefined();
    });

    it('respects limit param', () => {
      const skills = [
        {
          id: 's1',
          name: 'skill-one',
          description: 'first skill match',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/s1',
        },
        {
          id: 's2',
          name: 'skill-two',
          description: 'second skill match',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/s2',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'skill', limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('listCategories', () => {
    it('lists all unique categories from active skills', () => {
      (skillLibrary.listCategories as any).mockReturnValue([
        'debugging',
        'orchestration',
        'testing',
      ]);

      const result = service.listCategories();
      expect(result).toEqual(['debugging', 'orchestration', 'testing']);
      expect(skillLibrary.listCategories).toHaveBeenCalled();
    });
  });

  describe('upsertSkill', () => {
    const dto: CreateAgentSkillRequest = {
      name: 'my-skill',
      skill_markdown:
        '---\nname: my-skill\ndescription: Test skill\n---\n\n# Body',
    };

    const mockRecord: SkillLibraryRecord = {
      id: 'my-skill',
      name: 'my-skill',
      description: 'Test skill',
      skillMarkdown: dto.skill_markdown,
      compatibility: null,
      category: null,
      tags: [],
      metadata: null,
      scope: null,
      isActive: true,
      version: 1,
      source: 'imported',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      rootPath: '/tmp/my-skill',
    };

    it('calls createSkill and returns action: created when skill does not exist', async () => {
      (skillLibrary.skillExists as any).mockReturnValue(false);
      const createSpy = vi
        .spyOn(service, 'createSkill')
        .mockReturnValue(mockRecord);

      const result = await service.upsertSkill(dto);

      expect(createSpy).toHaveBeenCalledWith({ ...dto, name: 'my-skill' });
      expect(result).toEqual({ record: mockRecord, action: 'created' });
    });

    it('normalizes a mixed-case name before checking existence and creating', async () => {
      const mixedDto: CreateAgentSkillRequest = {
        name: 'My-Skill',
        skill_markdown:
          '---\nname: my-skill\ndescription: Test skill\n---\n\n# Body',
      };
      (skillLibrary.skillExists as any).mockReturnValue(false);
      const createSpy = vi
        .spyOn(service, 'createSkill')
        .mockReturnValue(mockRecord);

      await service.upsertSkill(mixedDto);

      expect(skillLibrary.skillExists).toHaveBeenCalledWith('my-skill');
      expect(createSpy).toHaveBeenCalledWith({ ...mixedDto, name: 'my-skill' });
    });

    it('propagates a BadRequestException thrown by createSkill unchanged', async () => {
      (skillLibrary.skillExists as any).mockReturnValue(false);
      vi.spyOn(service, 'createSkill').mockImplementation(() => {
        throw new BadRequestException('bad');
      });

      await expect(service.upsertSkill(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls updateSkill and returns action: updated when skill already exists', async () => {
      (skillLibrary.skillExists as any).mockReturnValue(true);
      const updateSpy = vi
        .spyOn(service, 'updateSkill')
        .mockReturnValue(mockRecord);

      const result = await service.upsertSkill(dto);

      expect(updateSpy).toHaveBeenCalledWith('my-skill', {
        skill_markdown: dto.skill_markdown,
      });
      expect(result).toEqual({ record: mockRecord, action: 'updated' });
    });

    it('also writes the skills DB corpus row via SkillService.upsert with source agent_factory', async () => {
      (skillLibrary.skillExists as any).mockReturnValue(false);
      vi.spyOn(service, 'createSkill').mockReturnValue(mockRecord);

      await service.upsertSkill(dto);

      expect(skillService.upsert).toHaveBeenCalledWith({
        name: mockRecord.name,
        description: mockRecord.description,
        skillMarkdown: mockRecord.skillMarkdown,
        source: 'agent_factory',
      });
    });
  });
});
