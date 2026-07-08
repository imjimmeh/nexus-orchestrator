import type { Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import type { SkillValidationService } from '../../../../ai-config/skills/skill-validation.service';

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

/**
 * Extracts the `name` field from YAML frontmatter.
 * Returns `fallback` when frontmatter is absent, malformed, or `name` is missing/empty.
 */
export function extractNameFromFrontmatter(
  markdown: string,
  fallback: string,
): string {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) return fallback;

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }

    const name = (parsed as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name.trim()) {
      return fallback;
    }

    return name.trim();
  } catch {
    return fallback;
  }
}

/**
 * Validates skill markdown via `SkillValidationService`.
 *
 * Returns a partial rejection shape when the markdown is invalid, or `null`
 * when it is valid (caller should proceed with persistence).
 *
 * Treats validator errors as fail-soft: if the service throws an unexpected
 * error, logs a warning and returns `null` so the caller can still proceed.
 */
export function tryValidateSkillMarkdown(
  service: SkillValidationService,
  logger: Logger,
  name: string,
  markdown: string,
): { validated: false; validation_errors: string[] } | null {
  try {
    const result = service.validateSkillMarkdown({ skillName: name, markdown });

    if (!result.valid) {
      logger.warn(
        `Skill validation rejected "${name}": ${result.errors.join(', ')}`,
      );
      return { validated: false, validation_errors: result.errors };
    }

    return null;
  } catch (err) {
    logger.warn(
      `Skill validator threw for "${name}" — falling through to persist: ${String(err)}`,
    );
    return null;
  }
}
