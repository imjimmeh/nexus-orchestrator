import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ReadPlaybookTool } from './read-playbook.tool';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

describe('ReadPlaybookTool', () => {
  let tool: ReadPlaybookTool;
  let skillsService: AgentSkillsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadPlaybookTool,
        {
          provide: AgentSkillsService,
          useValue: {
            getSkill: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<ReadPlaybookTool>(ReadPlaybookTool);
    skillsService = module.get<AgentSkillsService>(AgentSkillsService);
  });

  it('getName() should return read_playbook', () => {
    expect(tool.getName()).toBe('read_playbook');
  });

  it('execute() should return playbook if skill category is playbook', async () => {
    const mockSkill = {
      id: 'first-run',
      name: 'first-run',
      description: 'First run',
      category: 'playbook',
      tags: ['startup'],
      skillMarkdown: 'First orchestration content',
    };
    vi.mocked(skillsService.getSkill).mockReturnValue(mockSkill as any);

    const result = await tool.execute({}, { playbook_id: 'first-run' });

    expect(result).toMatchObject({
      playbook: {
        id: 'first-run',
        contentMarkdown: 'First orchestration content',
      },
    });
  });

  it('execute() should throw BadRequestException if skill category is not playbook', async () => {
    const mockSkill = {
      id: 'not-a-playbook',
      category: 'implementation',
    };
    vi.mocked(skillsService.getSkill).mockReturnValue(mockSkill as any);

    await expect(
      tool.execute({}, { playbook_id: 'not-a-playbook' }),
    ).rejects.toThrow(BadRequestException);
  });
});
