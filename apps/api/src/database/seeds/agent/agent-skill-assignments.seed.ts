import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentProfilesFileSeedService } from '../agent-profiles/agent-profiles-file-seed.service';
import { AgentProfileRepository } from '../../../ai-config/database/repositories/agent-profile.repository';

const SKILL_MARKDOWN_FILE = 'SKILL.md';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type AgentSkillAssignmentsSeed = Record<string, unknown>;
type SeedResult = 'updated' | 'skipped' | 'missing_profile';

interface SeedSummary {
  updatedCount: number;
  skippedCount: number;
  missingProfilesCount: number;
}

@Injectable()
export class AgentSkillAssignmentsSeedService {
  private readonly logger = new Logger(AgentSkillAssignmentsSeedService.name);
  private readonly configuredAssignmentsPath: string | null;
  private readonly skillsLibraryRoot: string;

  constructor(
    private readonly profiles: AgentProfileRepository,
    private readonly fileSeedService: AgentProfilesFileSeedService,
  ) {
    this.configuredAssignmentsPath =
      process.env.NEXUS_AGENT_SKILL_ASSIGNMENTS_SEED_PATH?.trim() || null;

    this.skillsLibraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');
  }

  async seed(): Promise<void> {
    if (this.fileSeedService.hasFileSeedDefinitions()) {
      this.logger.warn(
        'Skipping legacy agent skill assignment manifest seeding because file-based agent seeds are active. Configure assigned_skills in seed/agents/<agent-name>/agent.json.',
      );
      return;
    }

    const assignmentsPath = this.resolveAssignmentsPath();
    if (!assignmentsPath) {
      return;
    }

    const assignments = this.readAssignments(assignmentsPath);
    if (!assignments) {
      return;
    }

    const summary = await this.applyAssignments(assignments);
    this.logSeedSummary(summary);
  }

  private async applyAssignments(
    assignments: AgentSkillAssignmentsSeed,
  ): Promise<SeedSummary> {
    const summary: SeedSummary = {
      updatedCount: 0,
      skippedCount: 0,
      missingProfilesCount: 0,
    };

    const profileNames = Object.keys(assignments).sort((a, b) =>
      a.localeCompare(b),
    );

    for (const profileName of profileNames) {
      const result = await this.applyProfileAssignment(
        profileName,
        assignments[profileName],
      );
      this.accumulateSummary(summary, result);
    }

    return summary;
  }

  private async applyProfileAssignment(
    profileName: string,
    profileAssignments: unknown,
  ): Promise<SeedResult> {
    const normalizedSkills = this.normalizeSkillList(
      profileName,
      profileAssignments,
    );

    if (!normalizedSkills) {
      return 'skipped';
    }

    const profile = await this.profiles.findByNameInsensitive(profileName);
    if (!profile) {
      this.logger.warn(
        `Skipping agent skill assignment seed for ${profileName}: profile not found`,
      );
      return 'missing_profile';
    }

    const availableSkills = this.resolveAvailableSkills(
      profileName,
      normalizedSkills,
    );
    if (normalizedSkills.length > 0 && availableSkills.length === 0) {
      return 'skipped';
    }

    const nextAssignedSkills =
      availableSkills.length > 0 ? availableSkills : null;
    const currentAssignedSkills = this.normalizeExistingAssignedSkills(
      profile.assigned_skills,
    );

    if (
      this.areSkillListsEqual(currentAssignedSkills, nextAssignedSkills ?? [])
    ) {
      return 'skipped';
    }

    await this.profiles.update(profile.id, {
      assigned_skills: nextAssignedSkills,
    });
    return 'updated';
  }

  private resolveAvailableSkills(
    profileName: string,
    normalizedSkills: string[],
  ): string[] {
    const availableSkills = normalizedSkills.filter((skillName) =>
      this.isSeededSkillAvailable(skillName),
    );

    const missingSkills = normalizedSkills.filter(
      (skillName) => !availableSkills.includes(skillName),
    );

    if (missingSkills.length > 0) {
      this.logger.warn(
        `Profile ${profileName} references missing skills: ${missingSkills.join(', ')}`,
      );
    }

    return availableSkills;
  }

  private accumulateSummary(summary: SeedSummary, result: SeedResult): void {
    if (result === 'updated') {
      summary.updatedCount += 1;
      return;
    }

    if (result === 'missing_profile') {
      summary.missingProfilesCount += 1;
      return;
    }

    summary.skippedCount += 1;
  }

  private logSeedSummary(summary: SeedSummary): void {
    this.logger.log(
      `Agent skill assignment seed summary: updated=${summary.updatedCount.toString()}, skipped=${summary.skippedCount.toString()}, missing_profiles=${summary.missingProfilesCount.toString()}`,
    );
  }

  private readAssignments(
    assignmentsPath: string,
  ): AgentSkillAssignmentsSeed | null {
    try {
      const raw = fs.readFileSync(assignmentsPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          `Invalid agent skill assignments seed format in ${assignmentsPath}. Expected a JSON object.`,
        );
        return null;
      }

      return parsed as AgentSkillAssignmentsSeed;
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to parse agent skill assignments seed file ${assignmentsPath}: ${err.message}`,
      );
      return null;
    }
  }

  private resolveAssignmentsPath(): string | undefined {
    const candidatePaths = [
      this.configuredAssignmentsPath,
      path.join(process.cwd(), 'seed', 'agents', 'skill-assignments.seed.json'),
      path.join(
        process.cwd(),
        '..',
        'seed',
        'agents',
        'skill-assignments.seed.json',
      ),
      path.join(
        process.cwd(),
        '..',
        '..',
        'seed',
        'agents',
        'skill-assignments.seed.json',
      ),
      path.resolve(
        __dirname,
        '../../../../../../seed/agents/skill-assignments.seed.json',
      ),
    ].filter((candidate): candidate is string => Boolean(candidate));

    const resolvedPath = candidatePaths.find((candidate) =>
      fs.existsSync(candidate),
    );

    if (resolvedPath) {
      return resolvedPath;
    }

    this.logger.log(
      'Agent skill assignment seed file not found. Skipping assignment seeding.',
    );
    return undefined;
  }

  private normalizeSkillList(
    profileName: string,
    raw: unknown,
  ): string[] | null {
    if (!Array.isArray(raw)) {
      this.logger.warn(
        `Skipping agent skill assignment seed for ${profileName}: assignment value must be an array`,
      );
      return null;
    }

    const normalized: string[] = [];
    for (const value of raw) {
      if (typeof value !== 'string') {
        this.logger.warn(
          `Skipping non-string skill assignment for ${profileName}`,
        );
        continue;
      }

      const skillName = value.trim().toLowerCase();
      if (!skillName) {
        continue;
      }

      if (!SKILL_NAME_PATTERN.test(skillName)) {
        this.logger.warn(
          `Skipping invalid skill name (${skillName}) in assignment for ${profileName}`,
        );
        continue;
      }

      if (!normalized.includes(skillName)) {
        normalized.push(skillName);
      }
    }

    return normalized;
  }

  private isSeededSkillAvailable(skillName: string): boolean {
    const skillMarkdownPath = path.join(
      this.skillsLibraryRoot,
      skillName,
      SKILL_MARKDOWN_FILE,
    );

    return fs.existsSync(skillMarkdownPath);
  }

  private normalizeExistingAssignedSkills(
    value: string[] | null | undefined,
  ): string[] {
    if (!value || value.length === 0) {
      return [];
    }

    const normalized: string[] = [];
    for (const skillName of value) {
      const trimmed = skillName.trim().toLowerCase();
      if (!trimmed || normalized.includes(trimmed)) {
        continue;
      }
      normalized.push(trimmed);
    }

    return normalized;
  }

  private areSkillListsEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }

    return true;
  }
}
