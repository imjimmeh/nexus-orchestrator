import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type {
  SkillLibraryRecord,
  SkillScope,
  SkillScopeContext,
} from './agent-skill-library.service.types';
import { SkillIndexService } from './skill-search/skill-index.service';
import { ScopeService } from '../../scope/scope.service';

const SKILL_FRONTMATTER_PATTERN =
  /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_MARKDOWN_FILE = 'SKILL.md';

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  compatibility?: unknown;
  category?: unknown;
  tags?: unknown;
  metadata?: unknown;
  scope?: unknown;
  is_active?: unknown;
  version?: unknown;
}

@Injectable()
export class AgentSkillLibraryService {
  private readonly logger = new Logger(AgentSkillLibraryService.name);
  private readonly libraryRoot: string;

  constructor(
    private readonly skillIndex: SkillIndexService,
    private readonly scopeService: ScopeService,
  ) {
    this.libraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    fs.mkdirSync(this.libraryRoot, { recursive: true });
  }

  getLibraryRootPath(): string {
    return this.libraryRoot;
  }

  listSkills(params?: { includeInactive?: boolean }): SkillLibraryRecord[] {
    const includeInactive = params?.includeInactive ?? false;

    if (!fs.existsSync(this.libraryRoot)) {
      return [];
    }

    const records = fs
      .readdirSync(this.libraryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => this.tryReadSkillRecord(name))
      .filter((skill): skill is SkillLibraryRecord => Boolean(skill));

    return includeInactive
      ? records
      : records.filter((skill) => skill.isActive);
  }

  async listSkillsForScope(
    context: SkillScopeContext,
  ): Promise<SkillLibraryRecord[]> {
    const { scopeId, agentProfile, workflowId } = context;
    if (
      scopeId === undefined &&
      agentProfile === undefined &&
      workflowId === undefined
    ) {
      return [];
    }

    const scopeAncestorIds =
      scopeId !== undefined
        ? new Set(await this.scopeService.getAncestorIds(scopeId))
        : null;

    return this.listSkills().filter((skill) => {
      const scope = skill.scope;
      if (!scope) {
        return false;
      }

      return (
        (scopeAncestorIds !== null &&
          scope.projects.some((id) => scopeAncestorIds.has(id))) ||
        (agentProfile !== undefined && scope.agents.includes(agentProfile)) ||
        (workflowId !== undefined && scope.workflows.includes(workflowId))
      );
    });
  }

  listCategories(): string[] {
    const skills = this.listSkills({ includeInactive: true });
    const categories = new Set<string>();
    for (const skill of skills) {
      if (skill.category) {
        categories.add(skill.category);
      }
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }

  getSkill(name: string): SkillLibraryRecord {
    const normalized = this.normalizeSkillName(name);
    const record = this.tryReadSkillRecord(normalized);
    if (!record) {
      throw new NotFoundException(`Skill with name ${normalized} not found`);
    }
    return record;
  }

  skillExists(name: string): boolean {
    const normalized = this.normalizeSkillName(name);
    return this.tryReadSkillRecord(normalized) !== null;
  }

  writeSkillMarkdown(name: string, markdown: string): SkillLibraryRecord {
    const normalized = this.normalizeSkillName(name);
    const frontmatter = this.parseFrontmatter(markdown);

    const frontmatterName =
      typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
    if (!frontmatterName) {
      throw new BadRequestException(
        'skill_markdown frontmatter must include a non-empty name',
      );
    }

    if (frontmatterName !== normalized) {
      throw new BadRequestException(
        `skill_markdown frontmatter name must match skill name (${normalized})`,
      );
    }

    const frontmatterDescription =
      typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
    if (!frontmatterDescription) {
      throw new BadRequestException(
        'skill_markdown frontmatter must include a non-empty description',
      );
    }

    const skillDir = this.resolveSkillDirectory(normalized);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, SKILL_MARKDOWN_FILE),
      markdown,
      'utf8',
    );

    this.skillIndex.invalidateAll();
    return this.getSkill(normalized);
  }

  renameSkill(currentName: string, nextName: string): void {
    const current = this.normalizeSkillName(currentName);
    const next = this.normalizeSkillName(nextName);

    if (current === next) {
      return;
    }

    const currentDir = this.resolveSkillDirectory(current);
    const nextDir = this.resolveSkillDirectory(next);

    if (!fs.existsSync(currentDir)) {
      throw new NotFoundException(`Skill with name ${current} not found`);
    }

    if (fs.existsSync(nextDir)) {
      throw new BadRequestException(`Skill name already exists: ${next}`);
    }

    fs.renameSync(currentDir, nextDir);
    this.skillIndex.invalidateAll();
  }

  deleteSkill(name: string): void {
    const normalized = this.normalizeSkillName(name);
    const skillDir = this.resolveSkillDirectory(normalized);
    if (!fs.existsSync(skillDir)) {
      throw new NotFoundException(`Skill with name ${normalized} not found`);
    }

    fs.rmSync(skillDir, { recursive: true, force: true });
    this.skillIndex.invalidateAll();
  }

  listSkillFiles(name: string): Array<{
    path: string;
    sizeBytes: number;
    updatedAt: string;
  }> {
    const skill = this.getSkill(name);
    const files = this.listRelativeFiles(skill.rootPath);

    return files
      .filter((relativePath) => relativePath !== SKILL_MARKDOWN_FILE)
      .map((relativePath) => {
        const absolutePath = path.join(skill.rootPath, relativePath);
        const stats = fs.statSync(absolutePath);
        return {
          path: relativePath,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
        };
      });
  }

  upsertSkillFile(
    name: string,
    relativePath: string,
    content: Buffer,
  ): Array<{ path: string; sizeBytes: number; updatedAt: string }> {
    const skill = this.getSkill(name);
    const safePath = this.resolveSafeRelativePath(relativePath);
    if (safePath === SKILL_MARKDOWN_FILE) {
      throw new BadRequestException(
        'Use skill update endpoint to modify SKILL.md content',
      );
    }

    const target = path.join(skill.rootPath, safePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);

    return this.listSkillFiles(name);
  }

  deleteSkillFile(
    name: string,
    relativePath: string,
  ): Array<{ path: string; sizeBytes: number; updatedAt: string }> {
    const skill = this.getSkill(name);
    const safePath = this.resolveSafeRelativePath(relativePath);
    if (safePath === SKILL_MARKDOWN_FILE) {
      throw new BadRequestException('SKILL.md cannot be deleted separately');
    }

    const target = path.join(skill.rootPath, safePath);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }

    return this.listSkillFiles(name);
  }

  private tryReadSkillRecord(name: string): SkillLibraryRecord | null {
    try {
      const normalizedSkillName = this.normalizeSkillName(name);
      const skillDir = this.resolveSkillDirectory(normalizedSkillName);
      const skillFile = path.join(skillDir, SKILL_MARKDOWN_FILE);

      const parsed = this.parseSkillFile(skillDir, skillFile);
      if (!parsed) {
        return null;
      }

      const parsedName = this.readFrontmatterString(parsed.frontmatter.name);
      const parsedDescription = this.readFrontmatterString(
        parsed.frontmatter.description,
      );

      if (!parsedName || !parsedDescription) {
        this.logger.warn(
          `Skipping malformed skill at ${skillDir}: missing name or description`,
        );
        return null;
      }

      if (parsedName !== normalizedSkillName) {
        this.logger.warn(
          `Skipping malformed skill at ${skillDir}: frontmatter name does not match directory`,
        );
        return null;
      }

      return this.buildSkillRecord(
        parsedName,
        parsedDescription,
        parsed,
        skillDir,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Skipping skill ${name.trim().toLowerCase()}: ${message}`,
      );
      return null;
    }
  }

  private parseSkillFile(
    skillDir: string,
    skillFile: string,
  ): {
    markdown: string;
    frontmatter: SkillFrontmatter;
    stats: fs.Stats;
  } | null {
    if (!fs.existsSync(skillFile)) {
      return null;
    }

    const markdown = fs.readFileSync(skillFile, 'utf8');
    const frontmatter = this.parseFrontmatter(markdown);
    const stats = fs.statSync(skillFile);
    if (!fs.existsSync(skillDir)) {
      return null;
    }

    return {
      markdown,
      frontmatter,
      stats,
    };
  }

  private readFrontmatterString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private buildSkillRecord(
    parsedName: string,
    parsedDescription: string,
    parsed: {
      markdown: string;
      frontmatter: SkillFrontmatter;
      stats: fs.Stats;
    },
    skillDir: string,
  ): SkillLibraryRecord {
    return {
      id: parsedName,
      name: parsedName,
      description: parsedDescription,
      skillMarkdown: parsed.markdown,
      compatibility:
        typeof parsed.frontmatter.compatibility === 'string'
          ? parsed.frontmatter.compatibility.trim() || null
          : null,
      category:
        typeof parsed.frontmatter.category === 'string'
          ? parsed.frontmatter.category.trim() || null
          : null,
      tags: Array.isArray(parsed.frontmatter.tags)
        ? parsed.frontmatter.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        : [],
      metadata:
        parsed.frontmatter.metadata &&
        typeof parsed.frontmatter.metadata === 'object' &&
        !Array.isArray(parsed.frontmatter.metadata)
          ? (parsed.frontmatter.metadata as Record<string, unknown>)
          : null,
      scope: this.parseScope(parsed.frontmatter.scope),
      isActive:
        typeof parsed.frontmatter.is_active === 'boolean'
          ? parsed.frontmatter.is_active
          : true,
      version: this.parseVersion(parsed.frontmatter.version),
      source: 'imported',
      createdAt: parsed.stats.birthtime,
      updatedAt: parsed.stats.mtime,
      rootPath: skillDir,
    };
  }

  private parseScope(value: unknown): SkillScope | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const projects = this.parseScopeList(record.projects);
    const agents = this.parseScopeList(record.agents);
    const workflows = this.parseScopeList(record.workflows);

    if (
      projects.length === 0 &&
      agents.length === 0 &&
      workflows.length === 0
    ) {
      return null;
    }

    return { projects, agents, workflows };
  }

  private parseScopeList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private parseVersion(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Math.max(1, Number.parseInt(value.trim(), 10));
    }

    return 1;
  }

  private resolveSkillDirectory(name: string): string {
    return path.join(this.libraryRoot, name);
  }

  private parseFrontmatter(markdown: string): SkillFrontmatter {
    const match = SKILL_FRONTMATTER_PATTERN.exec(markdown);
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

  private normalizeSkillName(name: string): string {
    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Skill name cannot be empty');
    }

    if (normalized.length > 64) {
      throw new BadRequestException('Skill name cannot exceed 64 characters');
    }

    if (!SKILL_NAME_PATTERN.test(normalized)) {
      throw new BadRequestException(
        'Skill name must be lowercase and may include letters, numbers, and hyphens',
      );
    }

    return normalized;
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

        const relativePath = path
          .relative(rootPath, absolutePath)
          .replaceAll('\\', '/');
        output.push(relativePath);
      }
    };

    visit(rootPath);
    return output.sort((a, b) => a.localeCompare(b));
  }

  private resolveSafeRelativePath(inputPath: string): string {
    const normalized = inputPath.trim().replaceAll('\\', '/');
    if (!normalized) {
      throw new BadRequestException('File path cannot be empty');
    }

    if (normalized.startsWith('/')) {
      throw new BadRequestException('File path must be relative');
    }

    const resolved = path.posix.normalize(normalized);
    if (
      resolved === '.' ||
      resolved.startsWith('../') ||
      resolved.includes('/../')
    ) {
      throw new BadRequestException('File path cannot escape skill directory');
    }

    return resolved;
  }
}
