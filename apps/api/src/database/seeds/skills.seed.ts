import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isRuntimeAuthored } from '../../ai-config/skills/skill-origin.helper';
import { SkillValidationService } from '../../ai-config/skills/skill-validation.service';

const SKILL_MARKDOWN_FILE = 'SKILL.md';

@Injectable()
export class SkillSeedService {
  private readonly logger = new Logger(SkillSeedService.name);
  private readonly configuredSkillsSeedRoot: string | null;
  private readonly skillsLibraryRoot: string;
  private readonly strictValidationEnabled: boolean;
  private readonly validationService: SkillValidationService;
  private readonly forceOverwrite: boolean;

  constructor(
    validationService: SkillValidationService = new SkillValidationService(),
  ) {
    this.configuredSkillsSeedRoot =
      process.env.NEXUS_SKILLS_SEED_PATH?.trim() || null;

    this.skillsLibraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    this.strictValidationEnabled =
      process.env.STRICT_SKILL_VALIDATION?.trim().toLowerCase() === 'true';

    this.forceOverwrite =
      process.env.NEXUS_SKILLS_SEED_FORCE_OVERWRITE === 'true';

    this.validationService = validationService;
  }

  seed(): void {
    const skillsSeedRoot = this.resolveSkillsSeedRoot();
    if (!skillsSeedRoot) {
      this.logger.log(
        'Skill seed directory not found. Skipping skill seeding.',
      );
      return;
    }

    fs.mkdirSync(this.skillsLibraryRoot, { recursive: true });

    const skillNames = this.listSkillDirectories(skillsSeedRoot);
    const knownSkillNames = new Set(skillNames);

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let preservedCount = 0;
    let invalidCount = 0;

    for (const skillName of skillNames) {
      const result = this.seedSkill({
        skillName,
        skillsSeedRoot,
        knownSkillNames,
      });

      if (result === 'created') {
        createdCount += 1;
      } else if (result === 'updated') {
        updatedCount += 1;
      } else if (result === 'skipped') {
        skippedCount += 1;
      } else if (result === 'preserved') {
        preservedCount += 1;
      } else {
        invalidCount += 1;
      }
    }

    this.logger.log(
      `Skill seed summary: created=${createdCount.toString()}, updated=${updatedCount.toString()}, skipped=${skippedCount.toString()}, preserved=${preservedCount.toString()}, invalid=${invalidCount.toString()}`,
    );

    if (this.strictValidationEnabled && invalidCount > 0) {
      throw new Error(
        `Skill seeding failed strict validation with ${invalidCount.toString()} invalid skill(s)`,
      );
    }
  }

  private seedSkill(params: {
    skillName: string;
    skillsSeedRoot: string;
    knownSkillNames: Set<string>;
  }): 'created' | 'updated' | 'skipped' | 'preserved' | 'invalid' {
    const sourceDir = path.join(params.skillsSeedRoot, params.skillName);
    const sourceMarkdownPath = path.join(sourceDir, SKILL_MARKDOWN_FILE);

    if (!fs.existsSync(sourceMarkdownPath)) {
      this.logger.warn(
        `Skipping skill seed ${params.skillName}: missing ${SKILL_MARKDOWN_FILE}`,
      );
      return 'invalid';
    }

    const sourceMarkdown = fs.readFileSync(sourceMarkdownPath, 'utf8');
    const validation = this.validationService.validateSkillMarkdown({
      skillName: params.skillName,
      markdown: sourceMarkdown,
      knownSkillNames: params.knownSkillNames,
      strict: this.strictValidationEnabled,
    });

    for (const warning of validation.warnings) {
      this.logger.warn(`Skill seed warning ${params.skillName}: ${warning}`);
    }

    if (!validation.valid) {
      this.logger.warn(
        `Skipping skill seed ${params.skillName}: ${validation.errors.join(', ')}`,
      );
      return 'invalid';
    }

    const targetDir = path.join(this.skillsLibraryRoot, params.skillName);
    const targetExists = fs.existsSync(targetDir);

    if (this.shouldPreserveTarget(targetDir, targetExists)) {
      this.logger.log(`Preserved runtime-authored skill: ${params.skillName}`);
      return 'preserved';
    }

    this.replaceDirectory(sourceDir, targetDir);
    return targetExists ? 'updated' : 'created';
  }

  /**
   * Returns true when the existing target skill was authored by the agent
   * runtime and the force-overwrite flag is not set. Fail-soft: an unreadable
   * or missing SKILL.md is treated as NOT runtime-authored.
   */
  private shouldPreserveTarget(
    targetDir: string,
    targetExists: boolean,
  ): boolean {
    if (!targetExists || this.forceOverwrite) {
      return false;
    }

    const existingMarkdown = this.readExistingSkillMarkdown(targetDir);
    return existingMarkdown !== null && isRuntimeAuthored(existingMarkdown);
  }

  private readExistingSkillMarkdown(targetDir: string): string | null {
    try {
      return fs.readFileSync(path.join(targetDir, SKILL_MARKDOWN_FILE), 'utf8');
    } catch {
      return null;
    }
  }

  private replaceDirectory(sourceDir: string, targetDir: string): void {
    const tempDir = this.createTempDirectory(targetDir);

    try {
      this.copyDirectory(sourceDir, tempDir);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(tempDir, targetDir);
    } catch (error) {
      this.removeDirectoryBestEffort(tempDir, 'temporary skill seed directory');
      throw error;
    }
  }

  private createTempDirectory(targetDir: string): string {
    const parentDir = path.dirname(targetDir);
    const tempPrefix = `.${path.basename(targetDir)}.tmp-`;
    return fs.mkdtempSync(path.join(parentDir, tempPrefix));
  }

  private removeDirectoryBestEffort(targetDir: string, context: string): void {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Failed to remove ${context} at ${targetDir}: ${this.describeError(error)}`,
      );
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private copyDirectory(sourceDir: string, targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });

    for (const name of fs.readdirSync(sourceDir)) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(targetDir, name);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        this.copyDirectory(sourcePath, targetPath);
        continue;
      }

      if (stat.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  private resolveSkillsSeedRoot(): string | undefined {
    const candidatePaths = [
      this.configuredSkillsSeedRoot,
      path.join(process.cwd(), 'seed', 'skills'),
      path.join(process.cwd(), '..', 'seed', 'skills'),
      path.join(process.cwd(), '..', '..', 'seed', 'skills'),
      path.resolve(__dirname, '../../../../../seed/skills'),
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidatePaths.find((candidate) => fs.existsSync(candidate));
  }

  private listSkillDirectories(root: string): string[] {
    return fs
      .readdirSync(root)
      .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
      .sort((a, b) => a.localeCompare(b));
  }
}
