import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillValidationService } from '../../../ai-config/skills/skill-validation.service';
import { SkillMetadataContract } from '../../../ai-config/skills/skill-validation.types';

const SKILL_MARKDOWN_FILE = 'SKILL.md';

@Injectable()
export class SkillDependencyResolverService {
  private readonly skillsLibraryRoot: string;
  private readonly strictValidationEnabled: boolean;
  private knownSkillsCache: Set<string> | null = null;

  constructor(
    private readonly validationService: SkillValidationService = new SkillValidationService(),
  ) {
    this.skillsLibraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    this.strictValidationEnabled =
      process.env.STRICT_SKILL_VALIDATION?.trim().toLowerCase() === 'true';
  }

  resolve(skillNames: string[]): string[] {
    const knownSkills = this.listKnownSkills();
    const metadataCache = new Map<string, SkillMetadataContract>();
    const resolved: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    for (const skillName of skillNames) {
      this.visitSkill({
        skillName,
        knownSkills,
        metadataCache,
        visiting,
        visited,
        resolved,
        ancestry: [],
      });
    }

    return resolved;
  }

  listKnownSkills(): Set<string> {
    if (this.knownSkillsCache !== null) {
      return this.knownSkillsCache;
    }

    if (!fs.existsSync(this.skillsLibraryRoot)) {
      this.knownSkillsCache = new Set<string>();
      return this.knownSkillsCache;
    }

    this.knownSkillsCache = new Set(
      fs
        .readdirSync(this.skillsLibraryRoot)
        .filter((name) =>
          fs.statSync(path.join(this.skillsLibraryRoot, name)).isDirectory(),
        )
        .filter((name) =>
          fs.existsSync(
            path.join(this.skillsLibraryRoot, name, SKILL_MARKDOWN_FILE),
          ),
        ),
    );

    return this.knownSkillsCache;
  }

  private visitSkill(params: {
    skillName: string;
    knownSkills: Set<string>;
    metadataCache: Map<string, SkillMetadataContract>;
    visiting: Set<string>;
    visited: Set<string>;
    resolved: string[];
    ancestry: string[];
  }): void {
    const {
      skillName,
      knownSkills,
      metadataCache,
      visiting,
      visited,
      resolved,
      ancestry,
    } = params;

    if (visited.has(skillName)) {
      return;
    }

    if (!knownSkills.has(skillName)) {
      throw new Error(
        `Unknown skill referenced in dependency resolver: ${skillName}`,
      );
    }

    if (visiting.has(skillName)) {
      const cyclePath = [...ancestry, skillName].join(' -> ');
      throw new Error(`Circular skill dependency detected: ${cyclePath}`);
    }

    visiting.add(skillName);

    const metadata = this.getSkillMetadata(
      skillName,
      knownSkills,
      metadataCache,
    );
    for (const prerequisite of metadata.prerequisites) {
      this.visitSkill({
        skillName: prerequisite,
        knownSkills,
        metadataCache,
        visiting,
        visited,
        resolved,
        ancestry: [...ancestry, skillName],
      });
    }

    visiting.delete(skillName);
    visited.add(skillName);

    if (!resolved.includes(skillName)) {
      resolved.push(skillName);
    }
  }

  private getSkillMetadata(
    skillName: string,
    knownSkills: Set<string>,
    metadataCache: Map<string, SkillMetadataContract>,
  ): SkillMetadataContract {
    const cached = metadataCache.get(skillName);
    if (cached) {
      return cached;
    }

    const markdownPath = path.join(
      this.skillsLibraryRoot,
      skillName,
      SKILL_MARKDOWN_FILE,
    );

    if (!fs.existsSync(markdownPath)) {
      throw new Error(`Skill ${skillName} is missing ${SKILL_MARKDOWN_FILE}`);
    }

    const markdown = fs.readFileSync(markdownPath, 'utf8');
    const validation = this.validationService.validateSkillMarkdown({
      skillName,
      markdown,
      knownSkillNames: knownSkills,
      strict: this.strictValidationEnabled,
    });

    if (!validation.valid) {
      throw new Error(
        `Skill dependency resolver failed for ${skillName}: ${validation.errors.join(', ')}`,
      );
    }

    for (const warning of validation.warnings) {
      // Warnings are informational unless strict mode is enabled.
      // They are surfaced by the seed logger in strict validation rollouts.
      void warning;
    }

    const metadata: SkillMetadataContract = validation.metadata ?? {
      version: '0.0.0',
      prerequisites: [],
      tier: 'light',
      estimated_duration: 'unknown',
      category: 'uncategorized',
      tags: [],
    };

    metadataCache.set(skillName, metadata);
    return metadata;
  }
}
