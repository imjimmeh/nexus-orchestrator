import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadSkillManifestTool } from './read-skill-manifest.tool';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

describe('ReadSkillManifestTool', () => {
  let tool: ReadSkillManifestTool;
  let skillsService: AgentSkillsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadSkillManifestTool,
        {
          provide: AgentSkillsService,
          useValue: {
            getSkill: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<ReadSkillManifestTool>(ReadSkillManifestTool);
    skillsService = module.get<AgentSkillsService>(AgentSkillsService);
  });

  it('should be defined', () => {
    expect(tool).toBeDefined();
  });

  it('getName() should return read_skill_manifest', () => {
    expect(tool.getName()).toBe('read_skill_manifest');
  });

  it('execute() should call skillsService.getSkill and return skill manifest', async () => {
    const params = { skill_id: 'test-driven-development' };
    const mockSkill = {
      id: 'test-driven-development',
      name: 'test-driven-development',
      description: 'Drive implementation with tests.',
      category: 'implementation',
      tags: ['testing'],
      compatibility: 'TS',
      metadata: { author: 'Pi' },
      version: 1,
      skillMarkdown: '# TDD\nRed-Green-Refactor',
    };
    vi.mocked(skillsService.getSkill).mockReturnValue(mockSkill as any);

    const result = await tool.execute({}, params);

    expect(skillsService.getSkill).toHaveBeenCalledWith(params.skill_id);
    expect(result).toEqual({
      skill: mockSkill,
    });
  });

  it('execute() should accept skill_dir from agent fallback attempts', async () => {
    const mockSkill = {
      id: 'project-analysis',
      name: 'project-analysis',
      description: 'Analyze project state.',
      category: 'orchestration',
      tags: ['project'],
      compatibility: null,
      metadata: null,
      version: 1,
      skillMarkdown: '# Project Analysis',
    };
    vi.mocked(skillsService.getSkill).mockReturnValue(mockSkill as any);

    const result = await tool.execute({}, { skill_dir: 'project-analysis' });

    expect(skillsService.getSkill).toHaveBeenCalledWith('project-analysis');
    expect(result).toEqual({ skill: mockSkill });
  });
});
