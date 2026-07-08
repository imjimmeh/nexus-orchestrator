import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillDependencyResolverService } from '../skills/skill-dependency-resolver.service';

const SKILL_MARKDOWN_FILE = 'SKILL.md';

@Injectable()
export class AgentProfileSkillAssignmentResolverService {
  private readonly logger = new Logger(
    AgentProfileSkillAssignmentResolverService.name,
  );
  private readonly skillsLibraryRoot: string;
  private readonly dependencyResolver: SkillDependencyResolverService;

  constructor() {
    this.skillsLibraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    this.dependencyResolver = new SkillDependencyResolverService();
  }

  resolveAssignedSkills(
    profileName: string,
    configuredSkills: string[] | undefined,
    _existingSkills: string[] | null | undefined,
  ): string[] | null {
    const normalizedConfiguredSkills = this.normalizeSkills(configuredSkills);
    if (normalizedConfiguredSkills.length === 0) {
      return null;
    }

    const availableSkills = normalizedConfiguredSkills.filter((skillName) =>
      this.isSeededSkillAvailable(skillName),
    );

    const missingSkills = normalizedConfiguredSkills.filter(
      (skillName) => !availableSkills.includes(skillName),
    );

    if (missingSkills.length > 0) {
      const message = `Profile ${profileName} references missing skills: ${missingSkills.join(', ')}`;
      this.logger.warn(message);
      throw new Error(message);
    }

    if (availableSkills.length > 0) {
      const resolvedWithPrerequisites =
        this.dependencyResolver.resolve(availableSkills);

      return resolvedWithPrerequisites.length > 0
        ? resolvedWithPrerequisites
        : null;
    }

    return null;
  }

  areSkillAssignmentsEqual(
    left: string[] | null | undefined,
    right: string[] | null | undefined,
  ): boolean {
    return this.stringifySkills(left) === this.stringifySkills(right);
  }

  private normalizeSkills(skills: string[] | null | undefined): string[] {
    if (!skills || skills.length === 0) {
      return [];
    }

    const normalized: string[] = [];
    for (const skillName of skills) {
      const trimmed = skillName.trim().toLowerCase();
      if (!trimmed || normalized.includes(trimmed)) {
        continue;
      }

      normalized.push(trimmed);
    }

    return normalized;
  }

  private stringifySkills(skills: string[] | null | undefined): string {
    return this.normalizeSkills(skills).join(',');
  }

  private isSeededSkillAvailable(skillName: string): boolean {
    const skillMarkdownPath = path.join(
      this.skillsLibraryRoot,
      skillName,
      SKILL_MARKDOWN_FILE,
    );

    return fs.existsSync(skillMarkdownPath);
  }
}
