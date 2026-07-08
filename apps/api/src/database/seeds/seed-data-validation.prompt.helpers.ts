import { addIssue } from './seed-data-validation.shared';
import type { SeedValidationIssue } from './seed-data-validation.types';

const TOOL_REFERENCE_PATTERNS = [
  /\bcall(?:ing)?\s+(?:the\s+)?`?([a-z][a-z0-9]*(?:[_:][a-z0-9_:-]+)+)`?/gi,
  /\b`([a-z][a-z0-9]*(?:[_:][a-z0-9_:-]+)+)`\s+tool\b/gi,
  /\b([a-z][a-z0-9]*(?:[_:][a-z0-9_:-]+)+)\s+tool\b/gi,
  /\baction[=:]\s*`?([a-z][a-z0-9]*(?:[_:][a-z0-9_:-]+)+)`?/gi,
] as const;

const INPUT_GOALS_PATTERN = /\{\{\s*inputs\.goals\s*\}\}/;
const TRIGGER_GOALS_PATTERN = /\{\{\s*trigger\.goals\s*\}\}/;
const INPUT_GOALS_GUARD_PATTERN = /\{\{#if\s+inputs\.goals\s*\}\}/;
const TRIGGER_GOALS_GUARD_PATTERN = /\{\{#if\s+trigger\.goals\s*\}\}/;
const REMOVED_AGGREGATE_TOOL_NAME = 'nexus' + '_orchestrator';
const NEXUS_ORCHESTRATOR_REFERENCE_PATTERN = new RegExp(
  `\\b${REMOVED_AGGREGATE_TOOL_NAME}\\b(?:\\s+action\\s*[:=]|\\s*:)?`,
  'i',
);

function isKnownPromptToolReference(
  reference: string,
  knownToolNames: Set<string>,
): boolean {
  if (knownToolNames.has(reference)) {
    return true;
  }

  return false;
}

function isDeniedInstruction(content: string, reference: string): boolean {
  const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `\\bdo\\s+not\\s+call\\s+${escapedReference}\\b`,
    'iu',
  ).test(content);
}

export function extractPromptToolReferenceCandidates(
  content: string,
): string[] {
  const references = new Set<string>();

  for (const pattern of TOOL_REFERENCE_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const candidate = match[1]?.trim().replace(/[.,:;]+$/u, '');
      if (candidate) {
        references.add(candidate);
      }
    }
  }

  return [...references].sort((left, right) => left.localeCompare(right));
}

export function detectUnguardedGoalPlaceholders(content: string): string[] {
  const placeholders: string[] = [];

  if (
    INPUT_GOALS_PATTERN.test(content) &&
    !INPUT_GOALS_GUARD_PATTERN.test(content)
  ) {
    placeholders.push('inputs.goals');
  }

  if (
    TRIGGER_GOALS_PATTERN.test(content) &&
    !TRIGGER_GOALS_GUARD_PATTERN.test(content)
  ) {
    placeholders.push('trigger.goals');
  }

  return placeholders;
}

export function validatePromptContent(params: {
  content: string;
  knownToolNames: Set<string>;
  issues: SeedValidationIssue[];
  filePath: string;
  issueCodePrefix: 'agent-prompt' | 'workflow-prompt';
  workflowId?: string;
  agentName?: string;
}): void {
  if (NEXUS_ORCHESTRATOR_REFERENCE_PATTERN.test(params.content)) {
    addIssue(params.issues, {
      code: `${params.issueCodePrefix}-aggregate-tool-reference`,
      filePath: params.filePath,
      workflowId: params.workflowId,
      agentName: params.agentName,
      message: `Prompt references removed aggregate tool '${REMOVED_AGGREGATE_TOOL_NAME}'; use raw tool names instead`,
    });
  }

  for (const reference of extractPromptToolReferenceCandidates(
    params.content,
  )) {
    if (isKnownPromptToolReference(reference, params.knownToolNames)) {
      continue;
    }

    if (isDeniedInstruction(params.content, reference)) {
      continue;
    }

    addIssue(params.issues, {
      code: `${params.issueCodePrefix}-tool-missing`,
      filePath: params.filePath,
      workflowId: params.workflowId,
      agentName: params.agentName,
      message: `Prompt references unknown or non-callable tool '${reference}'`,
    });
  }

  for (const placeholder of detectUnguardedGoalPlaceholders(params.content)) {
    addIssue(params.issues, {
      code: `${params.issueCodePrefix}-goals-unguarded`,
      filePath: params.filePath,
      workflowId: params.workflowId,
      agentName: params.agentName,
      message:
        `Prompt references '{{${placeholder}}}' without a guarding '{{#if ${placeholder}}}' block; ` +
        'empty goals will render misleading prompt text.',
    });
  }
}
