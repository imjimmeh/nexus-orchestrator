import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SearchPlaybooksTool } from './search-playbooks.tool';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

describe('SearchPlaybooksTool', () => {
  let tool: SearchPlaybooksTool;
  let skillsService: AgentSkillsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchPlaybooksTool,
        {
          provide: AgentSkillsService,
          useValue: {
            searchSkills: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<SearchPlaybooksTool>(SearchPlaybooksTool);
    skillsService = module.get<AgentSkillsService>(AgentSkillsService);
  });

  it('getName() should return search_playbooks', () => {
    expect(tool.getName()).toBe('search_playbooks');
  });

  it('execute() should call searchSkills with category playbook', async () => {
    const params = { query: 'startup', tags: ['startup'] };
    vi.mocked(skillsService.searchSkills).mockReturnValue([]);

    await tool.execute({}, params);

    expect(skillsService.searchSkills).toHaveBeenCalledWith({
      ...params,
      category: 'playbook',
    });
  });
});
