import type { PromptContractMentions } from './seed-data-validation.contract-compiler.types';
import { extractPromptToolReferenceCandidates } from './seed-data-validation.prompt.helpers';

const TOOL_NAME_PATTERNS = [
  /`([a-z][a-z0-9]*(?:[_.:][a-z0-9_:-]+)+)`/giu,
  /tool_name\s*[:=]\s*["']([^"']+)["']/giu,
  /use\s+the\s+([a-z0-9_.:-]+)\s+tool/giu,
] as const;

const SET_OUTPUT_PATTERNS = [
  /set_job_output\s*\(\s*["']([^"']+)["']/giu,
  /set_job_output\s+for\s+[`"']?([a-zA-Z0-9_.-]+)[`"']?/giu,
  /output\s+key\s+[`"']?([a-zA-Z0-9_.-]+)[`"']?/giu,
] as const;

const EVENT_PATTERNS = [
  /\b([A-Z][A-Za-z0-9]*Event)\b/gu,
  /\b([a-z]+\.[a-z0-9_.-]+\.v\d+)\b/gu,
] as const;

export function extractPromptContractMentions(
  content: string,
): PromptContractMentions {
  return {
    toolNames: unique([
      ...extractPromptToolReferenceCandidates(content),
      ...extractMatches(content, TOOL_NAME_PATTERNS),
    ]),
    setJobOutputKeys: unique(extractMatches(content, SET_OUTPUT_PATTERNS)),
    eventNames: unique(extractMatches(content, EVENT_PATTERNS)),
  };
}

function extractMatches(
  content: string,
  patterns: readonly RegExp[],
): string[] {
  return patterns.flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => match[1]).filter(Boolean),
  );
}

function unique(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim().replace(/[.,:;]+$/u, ''))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
