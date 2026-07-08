import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSkillLibraryService } from './agent-skill-library.service';

const mockSkillIndex = {
  invalidateAll: vi.fn(),
  invalidate: vi.fn(),
  isBuilt: vi.fn().mockReturnValue(false),
  build: vi.fn(),
  getAll: vi.fn().mockReturnValue([]),
  get: vi.fn().mockReturnValue(undefined),
  searchTokens: vi.fn().mockReturnValue(new Set()),
} as any;

const mockScopeService = {
  getAncestorIds: vi.fn(async (nodeId: string) => [nodeId]),
} as any;

const VALID_MARKDOWN = (name: string) =>
  `---\nname: ${name}\ndescription: A test skill\n---\n\n# Body`;

describe('AgentSkillLibraryService', () => {
  let tempRoot: string;
  let service: AgentSkillLibraryService;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-library-'));
    process.env.NEXUS_SKILLS_LIBRARY_PATH = tempRoot;
    service = new AgentSkillLibraryService(mockSkillIndex, mockScopeService);
  });

  afterEach(() => {
    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('writeSkillMarkdown', () => {
    it('writes markdown and returns the skill record', () => {
      const record = service.writeSkillMarkdown(
        'my-skill',
        VALID_MARKDOWN('my-skill'),
      );

      expect(record.name).toBe('my-skill');
      expect(record.description).toBe('A test skill');
    });

    it('calls skillIndex.invalidateAll after writing', () => {
      service.writeSkillMarkdown('my-skill', VALID_MARKDOWN('my-skill'));

      expect(mockSkillIndex.invalidateAll).toHaveBeenCalledOnce();
    });

    it('throws BadRequestException when frontmatter name is missing', () => {
      const markdown = `---\ndescription: No name here\n---\n\n# Body`;

      expect(() => service.writeSkillMarkdown('my-skill', markdown)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when frontmatter name does not match', () => {
      expect(() =>
        service.writeSkillMarkdown('my-skill', VALID_MARKDOWN('other-skill')),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when description is missing', () => {
      const markdown = `---\nname: my-skill\n---\n\n# Body`;

      expect(() => service.writeSkillMarkdown('my-skill', markdown)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('renameSkill', () => {
    it('renames an existing skill directory', () => {
      service.writeSkillMarkdown('old-skill', VALID_MARKDOWN('old-skill'));
      vi.clearAllMocks();

      service.renameSkill('old-skill', 'new-skill');

      expect(fs.existsSync(path.join(tempRoot, 'new-skill'))).toBe(true);
      expect(fs.existsSync(path.join(tempRoot, 'old-skill'))).toBe(false);
    });

    it('calls skillIndex.invalidateAll after renaming', () => {
      service.writeSkillMarkdown('old-skill', VALID_MARKDOWN('old-skill'));
      vi.clearAllMocks();

      service.renameSkill('old-skill', 'new-skill');

      expect(mockSkillIndex.invalidateAll).toHaveBeenCalledOnce();
    });

    it('does nothing when current and next names are identical', () => {
      service.writeSkillMarkdown('my-skill', VALID_MARKDOWN('my-skill'));
      vi.clearAllMocks();

      service.renameSkill('my-skill', 'my-skill');

      expect(mockSkillIndex.invalidateAll).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the skill does not exist', () => {
      expect(() => {
        service.renameSkill('ghost', 'new-ghost');
      }).toThrow(NotFoundException);
    });

    it('throws BadRequestException when the target name already exists', () => {
      service.writeSkillMarkdown('skill-a', VALID_MARKDOWN('skill-a'));
      service.writeSkillMarkdown('skill-b', VALID_MARKDOWN('skill-b'));
      vi.clearAllMocks();

      expect(() => {
        service.renameSkill('skill-a', 'skill-b');
      }).toThrow(BadRequestException);
    });
  });

  describe('deleteSkill', () => {
    it('removes the skill directory', () => {
      service.writeSkillMarkdown('my-skill', VALID_MARKDOWN('my-skill'));
      vi.clearAllMocks();

      service.deleteSkill('my-skill');

      expect(fs.existsSync(path.join(tempRoot, 'my-skill'))).toBe(false);
    });

    it('calls skillIndex.invalidateAll after deleting', () => {
      service.writeSkillMarkdown('my-skill', VALID_MARKDOWN('my-skill'));
      vi.clearAllMocks();

      service.deleteSkill('my-skill');

      expect(mockSkillIndex.invalidateAll).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException when the skill does not exist', () => {
      expect(() => {
        service.deleteSkill('ghost');
      }).toThrow(NotFoundException);
    });
  });

  describe('listSkills', () => {
    it('returns an empty array when no skills exist', () => {
      expect(service.listSkills()).toEqual([]);
    });

    it('returns active skills by default', () => {
      service.writeSkillMarkdown(
        'active-skill',
        VALID_MARKDOWN('active-skill'),
      );

      const list = service.listSkills();

      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe('active-skill');
    });
  });

  describe('getSkill', () => {
    it('returns the skill record for a known skill', () => {
      service.writeSkillMarkdown('known-skill', VALID_MARKDOWN('known-skill'));

      const record = service.getSkill('known-skill');

      expect(record.name).toBe('known-skill');
    });

    it('throws NotFoundException for an unknown skill', () => {
      expect(() => service.getSkill('unknown')).toThrow(NotFoundException);
    });
  });

  describe('scope frontmatter', () => {
    const SCOPED_MARKDOWN = (name: string) =>
      `---\nname: ${name}\ndescription: A test skill\nscope:\n  projects: [scope-123]\n  agents: [software-architect]\n  workflows: [create_skill]\n---\n\n# Body`;

    it('parses scope arrays into the record', () => {
      const record = service.writeSkillMarkdown(
        'scoped-skill',
        SCOPED_MARKDOWN('scoped-skill'),
      );

      expect(record.scope).toEqual({
        projects: ['scope-123'],
        agents: ['software-architect'],
        workflows: ['create_skill'],
      });
    });

    it('returns null scope when no scope frontmatter is present', () => {
      const record = service.writeSkillMarkdown(
        'global-skill',
        VALID_MARKDOWN('global-skill'),
      );

      expect(record.scope).toBeNull();
    });

    it('returns null scope when all scope arrays are empty', () => {
      const markdown = `---\nname: empty-scope\ndescription: A test skill\nscope:\n  projects: []\n---\n\n# Body`;
      const record = service.writeSkillMarkdown('empty-scope', markdown);

      expect(record.scope).toBeNull();
    });
  });

  describe('listSkillsForScope', () => {
    const SCOPED = (name: string, scopeYaml: string) =>
      `---\nname: ${name}\ndescription: A test skill\n${scopeYaml}---\n\n# Body`;

    beforeEach(() => {
      service.writeSkillMarkdown(
        'global-skill',
        VALID_MARKDOWN('global-skill'),
      );
      service.writeSkillMarkdown(
        'project-skill',
        SCOPED('project-skill', 'scope:\n  projects: [scope-123]\n'),
      );
      service.writeSkillMarkdown(
        'agent-skill',
        SCOPED('agent-skill', 'scope:\n  agents: [software-architect]\n'),
      );
      service.writeSkillMarkdown(
        'workflow-skill',
        SCOPED('workflow-skill', 'scope:\n  workflows: [create_skill]\n'),
      );
    });

    it('returns skills matching the project scopeId', async () => {
      const names = (
        await service.listSkillsForScope({ scopeId: 'scope-123' })
      ).map((s) => s.name);
      expect(names).toEqual(['project-skill']);
    });

    it('matches a project scope via an ancestor id (org-level scope.projects entry reaches a descendant query)', async () => {
      service.writeSkillMarkdown(
        'org-wide-skill',
        SCOPED('org-wide-skill', 'scope:\n  projects: [org-root]\n'),
      );
      mockScopeService.getAncestorIds.mockImplementationOnce(async () => [
        'org-root',
        'scope-999',
      ]);

      const names = (
        await service.listSkillsForScope({ scopeId: 'scope-999' })
      ).map((s) => s.name);

      expect(names).toEqual(['org-wide-skill']);
      expect(mockScopeService.getAncestorIds).toHaveBeenCalledWith('scope-999');
    });

    it('does not call getAncestorIds when no scopeId is given', async () => {
      await service.listSkillsForScope({ agentProfile: 'software-architect' });
      expect(mockScopeService.getAncestorIds).not.toHaveBeenCalled();
    });

    it('returns skills matching the agent profile', async () => {
      const names = (
        await service.listSkillsForScope({ agentProfile: 'software-architect' })
      ).map((s) => s.name);
      expect(names).toEqual(['agent-skill']);
    });

    it('returns skills matching the workflowId', async () => {
      const names = (
        await service.listSkillsForScope({ workflowId: 'create_skill' })
      ).map((s) => s.name);
      expect(names).toEqual(['workflow-skill']);
    });

    it('unions matches across all three axes and never returns global skills', async () => {
      const names = (
        await service.listSkillsForScope({
          scopeId: 'scope-123',
          agentProfile: 'software-architect',
          workflowId: 'create_skill',
        })
      )
        .map((s) => s.name)
        .sort();
      expect(names).toEqual(['agent-skill', 'project-skill', 'workflow-skill']);
    });

    it('returns nothing when no context keys are supplied', async () => {
      expect(await service.listSkillsForScope({})).toEqual([]);
    });
  });
});
