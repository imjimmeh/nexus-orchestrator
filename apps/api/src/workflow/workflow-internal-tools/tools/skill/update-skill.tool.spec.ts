import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateSkillTool } from './update-skill.tool';
import type { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';
import type { SkillLibraryRecord } from '../../../../ai-config/services/agent-skill-library.service.types';
import type { SkillValidationService } from '../../../../ai-config/skills/skill-validation.service';

const makeRecord = (name: string): SkillLibraryRecord => ({
  id: name,
  name,
  description: 'Test',
  skillMarkdown: `---\nname: ${name}\ndescription: Test\n---\n`,
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
  rootPath: `/tmp/${name}`,
});

describe('UpdateSkillTool', () => {
  const updateMock = vi.fn();
  const getSkillMock = vi.fn();
  const validateMock = vi.fn();
  let tool: UpdateSkillTool;

  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockReturnValue(makeRecord('my-skill'));
    getSkillMock.mockReturnValue(makeRecord('my-skill'));
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: true,
      errors: [],
      warnings: [],
      metadata: null,
    });
    tool = new UpdateSkillTool(
      {
        updateSkill: updateMock,
        getSkill: getSkillMock,
      } as unknown as AgentSkillsService,
      {
        validateSkillMarkdown: validateMock,
      } as unknown as SkillValidationService,
    );
  });

  it('getName returns update_skill', () => {
    expect(tool.getName()).toBe('update_skill');
  });

  it('calls updateSkill with skill_id and skill_markdown', async () => {
    const markdown =
      '---\nname: my-skill\ndescription: Updated\n---\n\n# Updated';

    await tool.execute({}, { skill_id: 'my-skill', skill_markdown: markdown });

    expect(updateMock).toHaveBeenCalledWith('my-skill', {
      skill_markdown: markdown,
    });
  });

  it('returns name and scope from the updated record', async () => {
    const record = makeRecord('my-skill');
    record.scope = { projects: ['scope-abc'], agents: [], workflows: [] };
    updateMock.mockReturnValue(record);

    const result = await tool.execute(
      {},
      {
        skill_id: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Updated\n---\n',
      },
    );

    expect(result).toMatchObject({ name: 'my-skill', scope: record.scope });
  });

  // --- Validation gate tests (Task 3) ---

  it('rejects invalid markdown: does not call updateSkill and returns validation errors with existing scope', async () => {
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: false,
      errors: ['frontmatter.name is required'],
      warnings: [],
      metadata: null,
    });
    const existingScope = { projects: ['proj-1'], agents: [], workflows: [] };
    getSkillMock.mockReturnValue({
      ...makeRecord('my-skill'),
      scope: existingScope,
    });

    const result = await tool.execute(
      {},
      {
        skill_id: 'my-skill',
        skill_markdown: 'no frontmatter here',
      },
    );

    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      name: 'my-skill',
      scope: existingScope,
      validated: false,
      validation_errors: ['frontmatter.name is required'],
    });
  });

  it('falls back to null scope on rejection when skill lookup fails', async () => {
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: false,
      errors: ['frontmatter.name is required'],
      warnings: [],
      metadata: null,
    });
    getSkillMock.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = await tool.execute(
      {},
      { skill_id: 'my-skill', skill_markdown: 'no frontmatter here' },
    );

    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ validated: false, scope: null });
  });

  it('persists and returns validated:true when markdown passes validation', async () => {
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: true,
      errors: [],
      warnings: [],
      metadata: null,
    });

    const result = await tool.execute(
      {},
      {
        skill_id: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Updated\n---\n',
      },
    );

    expect(updateMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ validated: true });
  });

  // --- Task 4: origin preservation tests ---

  it('re-stamps nexus_origin from existing skill onto the updated markdown', async () => {
    const existingMarkdown =
      "---\nname: my-skill\ndescription: Old\nnexus_origin:\n  source: agent_factory\n  stamped_at: '2026-01-15T12:00:00.000Z'\n---\n";
    getSkillMock.mockReturnValue({
      ...makeRecord('my-skill'),
      skillMarkdown: existingMarkdown,
    });

    const newMarkdown =
      '---\nname: my-skill\ndescription: Updated\n---\n\n# New body';
    await tool.execute(
      {},
      { skill_id: 'my-skill', skill_markdown: newMarkdown },
    );

    const calledWith = updateMock.mock.calls[0][0] as unknown;
    const skillMarkdown = (
      updateMock.mock.calls[0][1] as { skill_markdown: string }
    ).skill_markdown;
    expect(calledWith).toBe('my-skill');
    expect(skillMarkdown).toContain('nexus_origin:');
    expect(skillMarkdown).toContain('source: agent_factory');
  });

  it('does not add nexus_origin when the existing skill has no origin marker', async () => {
    // makeRecord has no nexus_origin — the default getSkillMock setup
    const newMarkdown =
      '---\nname: my-skill\ndescription: Updated\n---\n\n# New body';
    await tool.execute(
      {},
      { skill_id: 'my-skill', skill_markdown: newMarkdown },
    );

    const skillMarkdown = (
      updateMock.mock.calls[0][1] as { skill_markdown: string }
    ).skill_markdown;
    expect(skillMarkdown).not.toContain('nexus_origin');
  });

  it('falls through to persist when validator throws (fail-soft)', async () => {
    validateMock.mockImplementation(() => {
      throw new Error('validator boom');
    });

    const result = await tool.execute(
      {},
      {
        skill_id: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Test\n---\n',
      },
    );

    expect(validateMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ validated: true });
  });
});
