import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';
import {
  CONTAINER_SKILLS_ROOT,
  SKILL_CATALOG_FILE_NAME,
} from './skill-mounting.constants';

@Injectable()
export class SkillMountingService {
  private readonly logger = new Logger(SkillMountingService.name);
  private readonly baseTmpDir = path.join(os.tmpdir(), 'nexus-tools', 'skills');

  constructor() {
    if (!fs.existsSync(this.baseTmpDir)) {
      fs.mkdirSync(this.baseTmpDir, { recursive: true });
    }
  }

  prepareSkillMount(
    mountKey: string,
    skills: SkillLibraryRecord[],
  ): string | null {
    if (skills.length === 0) {
      return null;
    }

    const mountDir = path.join(this.baseTmpDir, mountKey);
    if (fs.existsSync(mountDir)) {
      fs.rmSync(mountDir, { recursive: true, force: true });
    }
    fs.mkdirSync(mountDir, { recursive: true });

    const catalog = skills.map((skill) => {
      const skillDir = path.join(mountDir, skill.name);
      if (fs.existsSync(skill.rootPath)) {
        fs.cpSync(skill.rootPath, skillDir, { recursive: true, force: true });
      } else {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      const skillMarkdownPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMarkdownPath)) {
        fs.writeFileSync(skillMarkdownPath, skill.skillMarkdown, 'utf8');
      }

      const referencedFiles = this.listRelativeFiles(skillDir).filter(
        (relativePath) => relativePath !== 'SKILL.md',
      );

      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: `${CONTAINER_SKILLS_ROOT}/${skill.name}/SKILL.md`,
        root: `${CONTAINER_SKILLS_ROOT}/${skill.name}`,
        resources: referencedFiles,
      };
    });

    fs.writeFileSync(
      path.join(mountDir, SKILL_CATALOG_FILE_NAME),
      JSON.stringify(catalog, null, 2),
      'utf8',
    );

    this.logger.log(
      `Prepared skill mount at ${mountDir} with ${skills.length.toString()} skills`,
    );
    return mountDir;
  }

  populateWorktreeSkills(skillMountPath: string, worktreePath: string): void {
    const agentSkillsDir = path.join(worktreePath, '.agents', 'skills');
    fs.mkdirSync(agentSkillsDir, { recursive: true });

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(skillMountPath, { withFileTypes: true });
    } catch {
      return;
    }

    const skillDirs = entries.filter((entry) => entry.isDirectory());

    for (const entry of skillDirs) {
      if (entry.name === SKILL_CATALOG_FILE_NAME.replace('.json', '')) {
        continue;
      }
      const src = path.join(skillMountPath, entry.name);
      const dest = path.join(agentSkillsDir, entry.name);
      try {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(
          `Failed to copy skill ${entry.name} to worktree: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Populated worktree skills at ${agentSkillsDir} with ${skillDirs.length.toString()} skills`,
    );
  }

  cleanupWorktreeSkills(worktreePath: string, mountKey: string): void {
    if (!worktreePath) return;

    const agentSkillsDir = path.join(worktreePath, '.agents', 'skills');
    const mountDir = path.join(this.baseTmpDir, mountKey);

    let skillNames: string[];
    try {
      skillNames = fs
        .readdirSync(mountDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // mount dir already cleaned up, nothing to do
      return;
    }

    for (const skillName of skillNames) {
      const dest = path.join(agentSkillsDir, skillName);
      try {
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
      } catch (err) {
        // best-effort cleanup
        this.logger.warn(
          `Failed to cleanup worktree skill ${skillName}: ${(err as Error).message}`,
        );
      }
    }
  }

  cleanupSkillMount(mountKey: string): void {
    const mountDir = path.join(this.baseTmpDir, mountKey);
    if (!fs.existsSync(mountDir)) {
      return;
    }

    try {
      fs.rmSync(mountDir, { recursive: true, force: true });
      this.logger.log(`Cleaned up skill mount for ${mountKey}`);
    } catch (e) {
      const error = e as Error;
      this.logger.error(
        `Failed to cleanup skill mount ${mountDir}: ${error.message}`,
      );
    }
  }

  private listRelativeFiles(rootPath: string): string[] {
    const output: string[] = [];
    const visit = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        output.push(
          path.relative(rootPath, absolutePath).replaceAll('\\', '/'),
        );
      }
    };

    visit(rootPath);
    return output.sort((a, b) => a.localeCompare(b));
  }
}
