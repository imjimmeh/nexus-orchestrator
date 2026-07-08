import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSkillTool } from './create-skill.tool';
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

describe('CreateSkillTool', () => {
  const upsertMock = vi.fn();
  const validateMock = vi.fn();
  let tool: CreateSkillTool;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockReturnValue({
      record: makeRecord('my-skill'),
      action: 'created',
    });
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: true,
      errors: [],
      warnings: [],
      metadata: null,
    });
    tool = new CreateSkillTool(
      { upsertSkill: upsertMock } as unknown as AgentSkillsService,
      {
        validateSkillMarkdown: validateMock,
      } as unknown as SkillValidationService,
    );
  });

  it('getName returns create_skill', () => {
    expect(tool.getName()).toBe('create_skill');
  });

  it('calls upsertSkill with the skill name and stamped markdown when no provenance provided', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: markdown,
      },
    );

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-skill' }),
    );
    const calledWith = upsertMock.mock.calls[0][0] as {
      skill_markdown: string;
    };
    expect(calledWith.skill_markdown).toContain('nexus_origin:');
  });

  it('returns action, name, scope and validated:true from the upsert result', async () => {
    const record = makeRecord('my-skill');
    record.scope = { projects: ['scope-123'], agents: [], workflows: [] };
    upsertMock.mockReturnValue({ record, action: 'updated' });

    const result = await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Test\n---\n',
      },
    );

    expect(result).toMatchObject({
      action: 'updated',
      name: 'my-skill',
      scope: record.scope,
      validated: true,
    });
  });

  it('injects source_proposal_id into frontmatter metadata', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: markdown,
        source_proposal_id: 'prop-abc',
      },
    );

    const calledWith = upsertMock.mock.calls[0][0] as {
      skill_markdown: string;
    };
    expect(calledWith.skill_markdown).toContain('source_proposal_id: prop-abc');
  });

  it('injects generated_from_run_id into frontmatter metadata', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: markdown,
        generated_from_run_id: 'run-xyz',
      },
    );

    const calledWith = upsertMock.mock.calls[0][0] as {
      skill_markdown: string;
    };
    expect(calledWith.skill_markdown).toContain(
      'generated_from_run_id: run-xyz',
    );
  });

  it('stamps nexus_origin in the markdown passed to upsertSkill even when no proposal/run ID is given', async () => {
    const markdown = '---\nname: my-skill\ndescription: Test\n---\n\n# Body';

    await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: markdown,
      },
    );

    const calledWith = upsertMock.mock.calls[0][0] as {
      skill_markdown: string;
    };
    expect(calledWith.skill_markdown).toContain('nexus_origin:');
    expect(calledWith.skill_markdown).toContain('source: agent_factory');
    expect(calledWith.skill_markdown).not.toContain('source_proposal_id');
    expect(calledWith.skill_markdown).not.toContain('generated_from_run_id');
  });

  it('merges provenance into existing metadata without overwriting other keys', async () => {
    const markdown =
      '---\nname: my-skill\ndescription: Test\nmetadata:\n  custom_key: hello\n---\n\n# Body';

    await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: markdown,
        source_proposal_id: 'prop-abc',
      },
    );

    const calledWith = upsertMock.mock.calls[0][0] as {
      skill_markdown: string;
    };
    expect(calledWith.skill_markdown).toContain('custom_key: hello');
    expect(calledWith.skill_markdown).toContain('source_proposal_id: prop-abc');
  });

  // --- Validation gate tests ---

  it('rejects invalid markdown: does not call upsertSkill and returns validation errors', async () => {
    validateMock.mockReturnValue({
      skillName: 'my-skill',
      valid: false,
      errors: ['frontmatter.name is required'],
      warnings: [],
      metadata: null,
    });

    const result = await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: 'no frontmatter here',
      },
    );

    expect(upsertMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      action: 'rejected',
      name: 'my-skill',
      scope: null,
      validated: false,
      validation_errors: ['frontmatter.name is required'],
    });
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
        name: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Test\n---\n',
      },
    );

    expect(upsertMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ validated: true });
  });

  it('falls through to persist when validator throws (fail-soft)', async () => {
    validateMock.mockImplementation(() => {
      throw new Error('validator boom');
    });

    const result = await tool.execute(
      {},
      {
        name: 'my-skill',
        skill_markdown: '---\nname: my-skill\ndescription: Test\n---\n',
      },
    );

    expect(upsertMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ name: 'my-skill' });
  });
});
