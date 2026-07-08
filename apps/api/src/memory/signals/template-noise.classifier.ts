import { Injectable } from '@nestjs/common';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { TemplateNoiseClassification } from './template-noise.classifier.types';
import { ORCHESTRATION_CYCLE_LESSON_TEMPLATE } from '../../settings/orchestration-cycle-candidate.settings.constants';

export type { TemplateNoiseClassification };

/**
 * Regex for the "recurring failures" templated emitter shape.
 *
 * Example: `Recurring auth failures (12 occurrences in 7 days)`
 */
const RECURRING_FAILURES_TEMPLATE =
  /^Recurring .+ failures \(\d+ occurrences in \d+ days\)$/;

/**
 * Regex for the "workflow completed cleanly" templated emitter shape.
 *
 * Example: `Workflow run 550e8400-e29b-41d4-a716-446655440000 for scope
 *           project-abc completed cleanly in 42s`
 */
const WORKFLOW_COMPLETED_CLEANLY_TEMPLATE =
  /^Workflow run [0-9a-f-]{36} for scope .+ completed cleanly in \d+s$/;

/**
 * A concrete anchor is any of:
 * - a file/directory path  (contains `/` or `\`)
 * - a snake_case identifier likely to be a table or tool name (≥ 2 parts)
 * - a shell command token (e.g. `npm`, `npx`, `git`, `docker`)
 * - a credential / secret keyword
 * - an imperative verb that signals an actionable lesson
 *
 * The heuristic is intentionally broad: any match means the text is NOT
 * low-signal.  False positives (real noise classified as actionable) are
 * preferable over silently dropping genuinely useful lessons.
 */
const CONCRETE_ANCHOR_PATTERN = new RegExp(
  // File / directory path indicators (forward or back slash)
  '[a-zA-Z0-9_-]+(?:/|\\\\)[a-zA-Z0-9_./-]+' +
    // snake_case identifiers with at least 2 parts — likely a table or tool name
    '|[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*){1,}' +
    // Common shell / CLI commands
    '|\\b(?:npm|npx|pnpm|yarn|git|docker|kubectl|make|bash|sh|curl|grep|sed|awk)\\b' +
    // Credential and secret references
    '|\\b(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|secret_store|vault)\\b' +
    // Imperative verbs that signal an actionable lesson
    '|\\b(?:add|always|avoid|call|check|configure|create|delete|deploy|disable|' +
    'edit|enable|ensure|exclude|fix|handle|implement|include|inspect|' +
    'migrate|modify|never|prefer|prevent|rebuild|remove|replace|require|' +
    'run|set|skip|store|update|use|verify|write)\\b',
  'i',
);

function matchesAnyTemplate(text: string): boolean {
  return (
    RECURRING_FAILURES_TEMPLATE.test(text) ||
    WORKFLOW_COMPLETED_CLEANLY_TEMPLATE.test(text) ||
    ORCHESTRATION_CYCLE_LESSON_TEMPLATE.test(text)
  );
}

function hasConcreteAnchor(text: string): boolean {
  return CONCRETE_ANCHOR_PATTERN.test(text);
}

/**
 * Pure classifier that detects content-free and low-signal learning
 * candidates so the sweep queue can exclude them without deleting them.
 *
 * This function has no side effects and requires no DI.  Import and call it
 * directly at the listing layer.
 *
 * @param candidate - The learning candidate to inspect.  Only `title` and
 *   `summary` are read; the rest of the entity is ignored.
 */
export function classifyTemplateNoise(
  candidate: Pick<LearningCandidate, 'title' | 'summary'>,
): TemplateNoiseClassification {
  const combined = `${candidate.title} ${candidate.summary}`.trim();

  const isTemplate =
    matchesAnyTemplate(candidate.title) ||
    matchesAnyTemplate(candidate.summary);
  const isLowSignal = isTemplate || !hasConcreteAnchor(combined);

  return { isTemplate, isLowSignal };
}

/**
 * Injectable wrapper that exposes `classifyTemplateNoise` as a NestJS provider.
 *
 * Callers that need DI-managed access (e.g. sweep-queue services) inject this
 * class; callers that have no DI context can import `classifyTemplateNoise`
 * directly.
 */
@Injectable()
export class TemplateNoiseClassifier {
  classify(
    candidate: Pick<LearningCandidate, 'title' | 'summary'>,
  ): TemplateNoiseClassification {
    return classifyTemplateNoise(candidate);
  }
}
