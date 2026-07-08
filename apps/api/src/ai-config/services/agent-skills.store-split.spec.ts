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

/**
 * Epic B, Task 10(a) — the `skill_assignment`/`skill_create` router
 * (`LearningRouterService`) decides its routing target off the `skills` DB
 * corpus (`SkillService.list()`), NOT the file-based skill library. Prior to
 * this fix, `AgentSkillsService.upsertSkill` only wrote the on-disk
 * `SKILL.md`, so every materialized skill was invisible to the router and it
 * kept proposing duplicate `skill_new` proposals for skills that already
 * existed. This spec locks in the store-split fix: `upsertSkill` must write
 * BOTH stores.
 */
describe('AgentSkillsService.upsertSkill store-split', () => {
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

  const dto: CreateAgentSkillRequest = {
    name: 'review-plan',
    description: 'Run review checklist',
    skill_markdown: validMarkdown,
  };

  const buildRecord = (
    overrides: Partial<SkillLibraryRecord> = {},
  ): SkillLibraryRecord => ({
    id: 'review-plan',
    name: 'review-plan',
    description: 'Run review checklist',
    skillMarkdown: validMarkdown,
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    scope: null,
    isActive: true,
    version: 1,
    source: 'agent_factory',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    rootPath: '/skills/review-plan',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    (profileRepo.findAll as any).mockResolvedValue([]);
    (skillService.upsert as any).mockResolvedValue({
      id: 'db-id-1',
      name: 'review-plan',
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

  it('writes both the SKILL.md file and the skills DB row on create', async () => {
    (skillLibrary.skillExists as any).mockReturnValue(false);
    const createdRecord = buildRecord();
    (skillLibrary.writeSkillMarkdown as any).mockReturnValue(createdRecord);

    const result = await service.upsertSkill(dto);

    // The on-disk file write still happens (backward compatible).
    expect(skillLibrary.writeSkillMarkdown).toHaveBeenCalledWith(
      'review-plan',
      dto.skill_markdown,
    );

    // The `skills` DB corpus row is ALSO written, with source 'agent_factory'
    // so the router's corpus scan (`SkillService.list()`) picks it up.
    expect(skillService.upsert).toHaveBeenCalledWith({
      name: 'review-plan',
      description: 'Run review checklist',
      skillMarkdown: validMarkdown,
      source: 'agent_factory',
    });

    expect(result).toEqual({ record: createdRecord, action: 'created' });
  });

  it('writes both the SKILL.md file and the skills DB row on update', async () => {
    (skillLibrary.skillExists as any).mockReturnValue(true);
    (skillLibrary.getSkill as any).mockReturnValue(buildRecord());
    const updatedRecord = buildRecord({ version: 2 });
    (skillLibrary.writeSkillMarkdown as any).mockReturnValue(updatedRecord);

    const result = await service.upsertSkill(dto);

    expect(skillLibrary.writeSkillMarkdown).toHaveBeenCalledWith(
      'review-plan',
      dto.skill_markdown,
    );
    expect(skillService.upsert).toHaveBeenCalledWith({
      name: 'review-plan',
      description: 'Run review checklist',
      skillMarkdown: validMarkdown,
      source: 'agent_factory',
    });
    expect(result).toEqual({ record: updatedRecord, action: 'updated' });
  });

  it('always stamps source agent_factory on the DB row regardless of the library record source', async () => {
    (skillLibrary.skillExists as any).mockReturnValue(false);
    const createdRecord = buildRecord({ source: 'imported' });
    (skillLibrary.writeSkillMarkdown as any).mockReturnValue(createdRecord);

    await service.upsertSkill(dto);

    expect(skillService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'agent_factory' }),
    );
  });

  it('resolves with the file-write result even when the corpus DB upsert rejects (best-effort)', async () => {
    (skillLibrary.skillExists as any).mockReturnValue(false);
    const createdRecord = buildRecord();
    (skillLibrary.writeSkillMarkdown as any).mockReturnValue(createdRecord);
    (skillService.upsert as any).mockRejectedValue(
      new Error('connection terminated'),
    );
    const warnSpy = vi
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await service.upsertSkill(dto);

    // The on-disk write already succeeded above; a corpus-write failure
    // must not surface as a rejection of the whole operation.
    expect(result).toEqual({ record: createdRecord, action: 'created' });
    expect(warnSpy).toHaveBeenCalled();
  });
});
