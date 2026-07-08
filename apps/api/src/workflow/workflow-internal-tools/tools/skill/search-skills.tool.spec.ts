import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SearchSkillsTool } from './search-skills.tool';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

describe('SearchSkillsTool', () => {
  let tool: SearchSkillsTool;
  let skillsService: AgentSkillsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchSkillsTool,
        {
          provide: AgentSkillsService,
          useValue: {
            searchSkills: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<SearchSkillsTool>(SearchSkillsTool);
    skillsService = module.get<AgentSkillsService>(AgentSkillsService);
  });

  it('should be defined', () => {
    expect(tool).toBeDefined();
  });

  it('getName() should return search_skills', () => {
    expect(tool.getName()).toBe('search_skills');
  });

  it('getDefinition() should match expected structure', () => {
    expect(tool.getDefinition()).toMatchObject({
      name: 'search_skills',
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
    });
  });

  it('execute() should call skillsService.searchSkills and return results', async () => {
    const params = {
      query: 'test',
      category: 'implementation',
      tags: ['testing'],
    };
    const mockSkills = [
      {
        id: 'test-driven-development',
        name: 'test-driven-development',
        description: 'Drive implementation with tests.',
        category: 'implementation',
        tags: ['testing'],
      },
    ];
    vi.mocked(skillsService.searchSkills).mockReturnValue(mockSkills as any);

    const result = await tool.execute({}, params);

    expect(skillsService.searchSkills).toHaveBeenCalledWith(params);
    expect(result).toEqual({
      results: [
        {
          id: 'test-driven-development',
          name: 'test-driven-development',
          description: 'Drive implementation with tests.',
          category: 'implementation',
          tags: ['testing'],
        },
      ],
    });
  });
});
