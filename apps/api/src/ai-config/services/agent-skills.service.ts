import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateAgentSkillRequest,
  UpdateAgentSkillRequest,
} from '@nexus/core';
import * as yaml from 'js-yaml';
import { AgentProfileRepository } from '../database/repositories/agent-profile.repository';
import { AgentSkillLibraryService } from './agent-skill-library.service';
import type {
  SkillLibraryRecord,
  SkillScopeContext,
} from './agent-skill-library.service.types';
import { SkillSearchPipelineService } from './skill-search/skill-search-pipeline.service';
import type { SkillSearchParams } from './skill-search/skill-search-strategy.types';
import { SkillService } from './skill.service';

/**
 * Materialized-skill source stamped on the `skills` DB corpus row so
 * `LearningRouterService.loadSkillCorpus` / `skillExists` see every
 * file-based skill written through {@link AgentSkillsService.upsertSkill}.
 */
const MATERIALIZED_SKILL_SOURCE = 'agent_factory' as const;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
}

@Injectable()
export class AgentSkillsService {
  private readonly logger = new Logger(AgentSkillsService.name);

  constructor(
    private readonly skillLibrary: AgentSkillLibraryService,
    private readonly pipeline: SkillSearchPipelineService,
    private readonly profiles: AgentProfileRepository,
    private readonly skillService: SkillService,
  ) {}

  listSkills(params?: { includeInactive?: boolean }) {
    return this.skillLibrary.listSkills(params);
  }

  listSkillsForScope(
    context: SkillScopeContext,
  ): Promise<SkillLibraryRecord[]> {
    return this.skillLibrary.listSkillsForScope(context);
  }

  searchSkills(params: SkillSearchParams): SkillLibraryRecord[] {
    const allSkills = this.skillLibrary.listSkills({ includeInactive: false });
    const scored = this.pipeline.search(params, allSkills);

    if (params.includeScores) {
      return scored.map(({ skill, score, matchDetails }) =>
        Object.assign(skill, { _score: score, _matchDetails: matchDetails }),
      );
    }

    return scored.map(({ skill }) => skill);
  }

  listCategories(skillIds?: string[]): string[] {
    if (!skillIds || skillIds.length === 0) {
      return this.skillLibrary.listCategories();
    }

    const records = skillIds
      .map((name) => this.tryGetSkillByName(name))
      .filter((skill): skill is SkillLibraryRecord => Boolean(skill))
      .filter((skill) => skill.isActive);

    const categories = records
      .map((skill) => skill.category)
      .filter((category): category is string => Boolean(category));

    return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
  }

  getSkill(id: string) {
    return this.skillLibrary.getSkill(id);
  }

  skillExists(name: string): boolean {
    return this.skillLibrary.skillExists(name);
  }

  createSkill(dto: CreateAgentSkillRequest): SkillLibraryRecord {
    const name = this.normalizeName(dto.name);
    if (this.skillLibrary.skillExists(name)) {
      throw new BadRequestException(`Skill name already exists: ${name}`);
    }

    this.validateSkillMarkdown(dto.skill_markdown, {
      expectedName: name,
      requireDescription: true,
    });

    return this.skillLibrary.writeSkillMarkdown(name, dto.skill_markdown);
  }

  async upsertSkill(dto: CreateAgentSkillRequest): Promise<{
    record: SkillLibraryRecord;
    action: 'created' | 'updated';
  }> {
    const name = this.normalizeName(dto.name);

    let record: SkillLibraryRecord;
    let action: 'created' | 'updated';
    if (this.skillLibrary.skillExists(name)) {
      record = this.updateSkill(name, { skill_markdown: dto.skill_markdown });
      action = 'updated';
    } else {
      record = this.createSkill({ ...dto, name });
      action = 'created';
    }

    // Store-split: every materialized skill must also land in the `skills`
    // DB corpus (read by `LearningRouterService.loadSkillCorpus` /
    // `skillExists`) or the router keeps proposing duplicate `skill_new`
    // proposals for skills that already exist on disk.
    //
    // Best-effort: the SKILL.md file write above (createSkill/updateSkill)
    // is the source of truth and has already succeeded by this point. A
    // corpus sync failure (e.g. transient DB error) must not surface as a
    // failure of the whole operation and must not diverge from the
    // file-write result already committed to disk.
    try {
      await this.skillService.upsert({
        name: record.name,
        description: record.description,
        skillMarkdown: record.skillMarkdown,
        source: MATERIALIZED_SKILL_SOURCE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Skill '${record.name}' ${action} on disk, but the skills DB corpus sync failed: ${message}`,
      );
    }

    return { record, action };
  }

  updateSkill(id: string, dto: UpdateAgentSkillRequest): SkillLibraryRecord {
    const existing = this.getSkill(id);

    const nextName = this.resolveNextName(existing, dto.name);

    const nextMarkdown = dto.skill_markdown ?? existing.skillMarkdown;
    this.validateSkillMarkdown(nextMarkdown, {
      expectedName: nextName,
      requireDescription: true,
    });

    if (nextName !== existing.name) {
      this.skillLibrary.renameSkill(existing.name, nextName);
    }

    return this.skillLibrary.writeSkillMarkdown(nextName, nextMarkdown);
  }

  async deleteSkill(id: string): Promise<void> {
    const skill = this.getSkill(id);

    const profiles = await this.profiles.findAll();
    await Promise.all(
      profiles.map(async (profile) => {
        const assignedSkills = profile.assigned_skills ?? [];
        const filtered = assignedSkills.filter((name) => name !== skill.name);
        if (filtered.length === assignedSkills.length) {
          return;
        }

        await this.profiles.update(profile.id, {
          assigned_skills: filtered.length > 0 ? filtered : null,
        });
      }),
    );

    this.skillLibrary.deleteSkill(skill.name);
  }

  async listSkillsForProfile(profileId: string) {
    const profile = await this.ensureProfileExists(profileId);
    const assignedNames = profile.assigned_skills ?? [];

    const records = assignedNames
      .map((name) => this.tryGetSkillByName(name))
      .filter((skill): skill is SkillLibraryRecord => Boolean(skill));

    return records.filter((skill) => skill.isActive);
  }

  async replaceProfileSkills(profileId: string, skillIds: string[]) {
    const profile = await this.ensureProfileExists(profileId);

    const normalizedIds = this.normalizeSkillIds(skillIds);
    this.assertSkillsExistAndActive(normalizedIds);

    await this.profiles.update(profile.id, {
      assigned_skills: normalizedIds.length > 0 ? normalizedIds : null,
    });

    return this.listSkillsForProfile(profileId);
  }

  async addProfileSkills(profileId: string, skillIds: string[]) {
    const profile = await this.ensureProfileExists(profileId);

    const normalizedIds = this.normalizeSkillIds(skillIds);
    this.assertSkillsExistAndActive(normalizedIds);

    const existingIds = this.normalizeAssignedSkillList(
      profile.assigned_skills,
    );
    const mergedIds = [...new Set([...existingIds, ...normalizedIds])];

    await this.profiles.update(profile.id, {
      assigned_skills: mergedIds.length > 0 ? mergedIds : null,
    });

    return this.listSkillsForProfile(profileId);
  }

  async addProfileSkillsByProfileName(profileName: string, skillIds: string[]) {
    const profile = await this.resolveProfileByName(profileName);
    return this.addProfileSkills(profile.id, skillIds);
  }

  async removeProfileSkills(profileId: string, skillIds: string[]) {
    const profile = await this.ensureProfileExists(profileId);

    const normalizedIds = this.normalizeSkillIds(skillIds);
    this.assertSkillsExistAndActive(normalizedIds);

    const existingIds = this.normalizeAssignedSkillList(
      profile.assigned_skills,
    );
    const idsToRemove = new Set(normalizedIds);
    const filteredIds = existingIds.filter((id) => !idsToRemove.has(id));

    await this.profiles.update(profile.id, {
      assigned_skills: filteredIds.length > 0 ? filteredIds : null,
    });

    return this.listSkillsForProfile(profileId);
  }

  async removeProfileSkillsByProfileName(
    profileName: string,
    skillIds: string[],
  ) {
    const profile = await this.resolveProfileByName(profileName);
    return this.removeProfileSkills(profile.id, skillIds);
  }

  async listSkillsByProfileName(profileName: string) {
    const profile = await this.profiles.findByName(profileName);
    if (!profile) {
      return [];
    }

    return this.listSkillsForProfile(profile.id);
  }

  listSkillFiles(skillId: string) {
    return this.skillLibrary.listSkillFiles(skillId);
  }

  upsertSkillFile(params: {
    skillId: string;
    relativePath: string;
    content: string;
    contentBase64?: string;
  }) {
    const normalizedPath = params.relativePath.trim();
    if (!normalizedPath) {
      throw new BadRequestException('relative_path is required');
    }

    const hasRaw = params.content.length > 0;
    const hasBase64 =
      typeof params.contentBase64 === 'string' &&
      params.contentBase64.length > 0;
    if (!hasRaw && !hasBase64) {
      throw new BadRequestException(
        'Either content or content_base64 must be provided',
      );
    }

    const fileContent = hasBase64
      ? Buffer.from(params.contentBase64 ?? '', 'base64')
      : Buffer.from(params.content, 'utf8');

    return this.skillLibrary.upsertSkillFile(
      params.skillId,
      normalizedPath,
      fileContent,
    );
  }

  deleteSkillFile(skillId: string, relativePath: string) {
    if (!relativePath.trim()) {
      throw new BadRequestException('path query parameter is required');
    }

    return this.skillLibrary.deleteSkillFile(skillId, relativePath);
  }

  private async ensureProfileExists(profileId: string) {
    const profile = await this.profiles.findById(profileId);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile with ID ${profileId} not found`,
      );
    }

    return profile;
  }

  private async resolveProfileByName(profileName: string) {
    const normalizedProfileName = profileName.trim();
    if (!normalizedProfileName) {
      throw new BadRequestException('profile_name is required');
    }

    const profile = await this.profiles.findByName(normalizedProfileName);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile with name ${normalizedProfileName} not found`,
      );
    }

    return profile;
  }

  private normalizeName(name: string): string {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Skill name cannot be empty');
    }

    if (!SKILL_NAME_PATTERN.test(normalized)) {
      throw new BadRequestException(
        'Skill name must be lowercase and may include letters, numbers, and hyphens',
      );
    }

    return normalized;
  }

  private resolveNextName(
    existing: SkillLibraryRecord,
    nextNameInput: string | undefined,
  ): string {
    if (typeof nextNameInput !== 'string') {
      return existing.name;
    }

    const nextName = this.normalizeName(nextNameInput);
    if (nextName === existing.name) {
      return nextName;
    }

    if (this.skillLibrary.skillExists(nextName)) {
      throw new BadRequestException(`Skill name already exists: ${nextName}`);
    }

    return nextName;
  }

  private validateSkillMarkdown(
    markdown: string,
    params: { expectedName: string; requireDescription: boolean },
  ): void {
    const frontmatter = this.parseFrontmatter(markdown);

    const parsedName =
      typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
    if (!parsedName) {
      throw new BadRequestException(
        'skill_markdown frontmatter must include a non-empty name',
      );
    }

    if (parsedName !== params.expectedName) {
      throw new BadRequestException(
        `skill_markdown frontmatter name must match skill name (${params.expectedName})`,
      );
    }

    if (params.requireDescription) {
      const parsedDescription =
        typeof frontmatter.description === 'string'
          ? frontmatter.description.trim()
          : '';
      if (!parsedDescription) {
        throw new BadRequestException(
          'skill_markdown frontmatter must include a non-empty description',
        );
      }
    }
  }

  private parseFrontmatter(markdown: string): SkillFrontmatter {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
    if (!match) {
      throw new BadRequestException(
        'skill_markdown must start with YAML frontmatter delimited by ---',
      );
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(match[1]);
    } catch {
      throw new BadRequestException(
        'skill_markdown has invalid YAML frontmatter',
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(
        'skill_markdown frontmatter must be a YAML object',
      );
    }

    return parsed;
  }

  private tryGetSkillByName(name: string): SkillLibraryRecord | null {
    try {
      return this.skillLibrary.getSkill(name);
    } catch {
      return null;
    }
  }

  private normalizeSkillIds(skillIds: string[]): string[] {
    return [...new Set(skillIds.map((id) => this.normalizeName(id)))];
  }

  private assertSkillsExistAndActive(skillIds: string[]): void {
    if (skillIds.length === 0) {
      return;
    }

    const activeSkills = skillIds
      .map((name) => this.tryGetSkillByName(name))
      .filter((skill): skill is SkillLibraryRecord => Boolean(skill))
      .filter((skill) => skill.isActive);

    if (activeSkills.length === skillIds.length) {
      return;
    }

    const activeIds = new Set(activeSkills.map((skill) => skill.name));
    const missingIds = skillIds.filter((id) => !activeIds.has(id));
    throw new BadRequestException(
      `Unknown or inactive skill IDs: ${missingIds.join(', ')}`,
    );
  }

  private normalizeAssignedSkillList(
    assignedSkills: string[] | null | undefined,
  ): string[] {
    if (!assignedSkills || assignedSkills.length === 0) {
      return [];
    }

    return assignedSkills
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
  }
}
