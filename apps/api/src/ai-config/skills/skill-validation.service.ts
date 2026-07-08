import { Injectable, Logger } from '@nestjs/common';
import * as yaml from 'js-yaml';
import {
  SkillMetadataContract,
  SkillValidationResult,
} from './skill-validation.types';

const SKILL_FRONTMATTER_PATTERN =
  /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const ALLOWED_CATEGORIES = [
  'architecture',
  'capability-authoring',
  'debugging',
  'documentation',
  'implementation',
  'orchestration',
  'playbook',
  'planning',
  'product',
  'quality',
  'refactoring',
  'research',
  'testing',
  'workflow-authoring',
] as const;
const REQUIRED_SECTIONS = [
  { name: 'Overview', synonyms: ['When to use', 'When to activate'] },
  {
    name: 'Prerequisites',
    synonyms: ['Required context', 'Context and inputs'],
  },
  {
    name: 'Instructions',
    synonyms: ['Execution guidance', 'Steps', 'Guidelines'],
  },
  {
    name: 'Output Format',
    synonyms: ['Output expectations', 'Expected output'],
  },
] as const;

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  metadata?: unknown;
  version?: unknown;
  prerequisites?: unknown;
  tier?: unknown;
  estimated_duration?: unknown;
  category?: unknown;
  tags?: unknown;
}

interface ValidationMessages {
  errors: string[];
  warnings: string[];
}

@Injectable()
export class SkillValidationService {
  private readonly logger = new Logger(SkillValidationService.name);

  validateSkillMarkdown(params: {
    skillName: string;
    markdown: string;
    knownSkillNames?: Set<string>;
    strict?: boolean;
  }): SkillValidationResult {
    const strictValidation = params.strict ?? this.isStrictValidationEnabled();
    const messages = this.createMessages();

    const frontmatter = this.parseFrontmatter(params.markdown);
    if (!frontmatter) {
      messages.errors.push('invalid or missing YAML frontmatter');
      return {
        skillName: params.skillName,
        valid: false,
        errors: messages.errors,
        warnings: messages.warnings,
        metadata: null,
      };
    }

    this.validateFrontmatterIdentity(
      frontmatter,
      params.skillName,
      messages.errors,
    );

    const metadataResult = this.validateMetadata(
      frontmatter,
      strictValidation,
      params.knownSkillNames,
    );
    messages.errors.push(...metadataResult.errors);
    messages.warnings.push(...metadataResult.warnings);

    this.validateRequiredSections(params.markdown, strictValidation, messages);

    return {
      skillName: params.skillName,
      valid: messages.errors.length === 0,
      errors: messages.errors,
      warnings: messages.warnings,
      metadata: metadataResult.metadata,
    };
  }

  assertValidSkill(params: {
    skillName: string;
    markdown: string;
    knownSkillNames?: Set<string>;
    strict?: boolean;
  }): SkillValidationResult {
    const result = this.validateSkillMarkdown(params);
    if (!result.valid) {
      const message = `Skill validation failed for ${params.skillName}: ${result.errors.join(', ')}`;
      throw new Error(message);
    }

    for (const warning of result.warnings) {
      this.logger.warn(
        `Skill validation warning (${params.skillName}): ${warning}`,
      );
    }

    return result;
  }

  isStrictValidationEnabled(): boolean {
    return process.env.STRICT_SKILL_VALIDATION?.trim().toLowerCase() === 'true';
  }

  private createMessages(): ValidationMessages {
    return {
      errors: [],
      warnings: [],
    };
  }

  private validateFrontmatterIdentity(
    frontmatter: SkillFrontmatter,
    skillName: string,
    errors: string[],
  ): void {
    const parsedName = this.readTrimmedString(frontmatter.name);
    const parsedDescription = this.readTrimmedString(frontmatter.description);

    if (!parsedName) {
      errors.push('frontmatter.name is required');
      return;
    }

    if (!parsedDescription) {
      errors.push('frontmatter.description is required');
    }

    if (!SKILL_NAME_PATTERN.test(parsedName)) {
      errors.push(`invalid skill name format (${parsedName})`);
    }

    if (parsedName !== skillName) {
      errors.push(
        `frontmatter name (${parsedName}) does not match directory (${skillName})`,
      );
    }
  }

  private validateRequiredSections(
    markdown: string,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): void {
    const body = this.stripFrontmatter(markdown);
    for (const section of REQUIRED_SECTIONS) {
      const namesToTry = [section.name, ...section.synonyms];
      let found = false;

      for (const name of namesToTry) {
        const sectionPattern = new RegExp(
          `^##\\s+${this.escapeRegex(name)}\\s*$`,
          'mi',
        );

        if (sectionPattern.test(body)) {
          found = true;
          break;
        }
      }

      if (!found) {
        this.pushIssue(
          messages,
          strictValidation,
          `missing required section: ${section.name} (checked aliases: ${section.synonyms.join(', ')})`,
        );
      }
    }
  }

  private validateMetadata(
    frontmatter: SkillFrontmatter,
    strictValidation: boolean,
    knownSkillNames?: Set<string>,
  ): {
    metadata: SkillMetadataContract | null;
    errors: string[];
    warnings: string[];
  } {
    const messages = this.createMessages();
    const metadata = this.readMetadataRecord(frontmatter.metadata) || {};

    // Read fields from top level, fallback to metadata block
    const version = this.readVersion(
      { ...metadata, version: frontmatter.version ?? metadata.version },
      strictValidation,
      messages,
    );
    const prerequisites = this.readPrerequisites(
      {
        ...metadata,
        prerequisites: frontmatter.prerequisites ?? metadata.prerequisites,
      },
      strictValidation,
      messages,
    );
    const tier = this.readTier(
      { ...metadata, tier: frontmatter.tier ?? metadata.tier },
      strictValidation,
      messages,
    );
    const estimatedDuration = this.readEstimatedDuration(
      {
        ...metadata,
        estimated_duration:
          frontmatter.estimated_duration ?? metadata.estimated_duration,
      },
      strictValidation,
      messages,
    );
    const category = this.readCategory(
      { ...metadata, category: frontmatter.category ?? metadata.category },
      strictValidation,
      messages,
    );
    const tags = this.readTags(
      { ...metadata, tags: frontmatter.tags ?? metadata.tags },
      strictValidation,
      messages,
    );
    const normalizedPrerequisites = this.normalizePrerequisites(
      prerequisites,
      strictValidation,
      messages,
    );
    this.validateKnownPrerequisites(
      normalizedPrerequisites,
      knownSkillNames,
      strictValidation,
      messages,
    );

    return {
      metadata: this.buildMetadata({
        version,
        prerequisites,
        normalizedPrerequisites,
        tier,
        estimatedDuration,
        category,
        tags,
      }),
      errors: messages.errors,
      warnings: messages.warnings,
    };
  }

  private readMetadataRecord(
    rawMetadata: unknown,
  ): Record<string, unknown> | null {
    if (
      !rawMetadata ||
      typeof rawMetadata !== 'object' ||
      Array.isArray(rawMetadata)
    ) {
      return null;
    }

    return rawMetadata as Record<string, unknown>;
  }

  private readVersion(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string | null {
    const version = this.readTrimmedString(metadata.version);
    if (version && SEMVER_PATTERN.test(version)) {
      return version;
    }

    this.pushIssue(
      messages,
      strictValidation,
      'metadata.version must be semver (x.y.z)',
    );
    return null;
  }

  private readPrerequisites(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string[] | null {
    const prerequisites = this.readStringArray(metadata.prerequisites);
    if (prerequisites) {
      return prerequisites;
    }

    this.pushIssue(
      messages,
      strictValidation,
      'metadata.prerequisites must be an array of skill names',
    );
    return null;
  }

  private readTier(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): SkillMetadataContract['tier'] | null {
    const tier = this.readTrimmedString(metadata.tier);
    if (tier === 'light' || tier === 'heavy') {
      return tier;
    }

    this.pushIssue(
      messages,
      strictValidation,
      'metadata.tier must be either light or heavy',
    );
    return null;
  }

  private readEstimatedDuration(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string | null {
    const estimatedDuration = this.readTrimmedString(
      metadata.estimated_duration,
    );
    if (estimatedDuration) {
      return estimatedDuration;
    }

    this.pushIssue(
      messages,
      strictValidation,
      'metadata.estimated_duration is required',
    );
    return null;
  }

  private readCategory(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string | null {
    const category = this.readTrimmedString(metadata.category);
    if (
      category &&
      (ALLOWED_CATEGORIES as readonly string[]).includes(category)
    ) {
      return category;
    }

    this.pushIssue(
      messages,
      strictValidation,
      `metadata.category is required and must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
    );
    return null;
  }

  private readTags(
    metadata: Record<string, unknown>,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string[] | null {
    const tags = this.readStringArray(metadata.tags);
    if (tags && tags.length > 0) {
      return tags;
    }

    this.pushIssue(
      messages,
      strictValidation,
      'metadata.tags must be a non-empty array of strings',
    );
    return null;
  }

  private normalizePrerequisites(
    prerequisites: string[] | null,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): string[] {
    const normalizedPrerequisites: string[] = [];
    for (const prerequisite of prerequisites ?? []) {
      if (!SKILL_NAME_PATTERN.test(prerequisite)) {
        this.pushIssue(
          messages,
          strictValidation,
          `metadata.prerequisites contains invalid skill name (${prerequisite})`,
        );
        continue;
      }

      if (!normalizedPrerequisites.includes(prerequisite)) {
        normalizedPrerequisites.push(prerequisite);
      }
    }

    return normalizedPrerequisites;
  }

  private validateKnownPrerequisites(
    prerequisites: string[],
    knownSkillNames: Set<string> | undefined,
    strictValidation: boolean,
    messages: ValidationMessages,
  ): void {
    if (!knownSkillNames || knownSkillNames.size === 0) {
      return;
    }

    for (const prerequisite of prerequisites) {
      if (knownSkillNames.has(prerequisite)) {
        continue;
      }

      this.pushIssue(
        messages,
        strictValidation,
        `metadata.prerequisites references unknown skill (${prerequisite})`,
      );
    }
  }

  private buildMetadata(params: {
    version: string | null;
    prerequisites: string[] | null;
    normalizedPrerequisites: string[];
    tier: SkillMetadataContract['tier'] | null;
    estimatedDuration: string | null;
    category: string | null;
    tags: string[] | null;
  }): SkillMetadataContract | null {
    if (
      !params.version ||
      !params.prerequisites ||
      !params.tier ||
      !params.estimatedDuration
    ) {
      return null;
    }

    return {
      version: params.version,
      prerequisites: params.normalizedPrerequisites,
      tier: params.tier,
      estimated_duration: params.estimatedDuration,
      category: params.category ?? 'uncategorized',
      tags: params.tags ?? [],
    };
  }

  private pushIssue(
    messages: ValidationMessages,
    strictValidation: boolean,
    issue: string,
  ): void {
    if (strictValidation) {
      messages.errors.push(issue);
      return;
    }

    messages.warnings.push(issue);
  }

  private parseFrontmatter(markdown: string): SkillFrontmatter | null {
    const match = SKILL_FRONTMATTER_PATTERN.exec(markdown);
    if (!match) {
      return null;
    }

    try {
      const parsed = yaml.load(match[1]);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private readTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const normalized: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') {
        return null;
      }

      const trimmed = item.trim();
      if (!trimmed || normalized.includes(trimmed)) {
        continue;
      }

      normalized.push(trimmed);
    }

    return normalized;
  }

  private stripFrontmatter(markdown: string): string {
    const match = SKILL_FRONTMATTER_PATTERN.exec(markdown);
    if (!match) {
      return markdown;
    }

    return markdown.slice(match[0].length);
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
