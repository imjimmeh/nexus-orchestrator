import type { NormalizedUsageTokens } from './usage-token-normalizer.types';

const INPUT_TOKEN_KEYS = [
  'input',
  'inputTokens',
  'input_tokens',
  'promptTokens',
  'prompt_tokens',
];

const OUTPUT_TOKEN_KEYS = [
  'output',
  'outputTokens',
  'output_tokens',
  'completionTokens',
  'completion_tokens',
];

const TOTAL_TOKEN_KEYS = ['totalTokens', 'total_tokens'];

function readTokenCount(
  usage: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }
  }

  return null;
}

/**
 * Normalises the heterogeneous `usage` object returned by different provider
 * engines into a consistent set of token counts. Providers disagree on key
 * names (`input` vs `inputTokens` vs `input_tokens` vs `prompt_tokens`), so we
 * probe a known set of aliases for each dimension.
 */
export function resolveUsageTokens(usage: unknown): NormalizedUsageTokens {
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }

  const usageRecord = usage as Record<string, unknown>;
  const inputTokens = readTokenCount(usageRecord, INPUT_TOKEN_KEYS);
  const outputTokens = readTokenCount(usageRecord, OUTPUT_TOKEN_KEYS);
  const explicitTotalTokens = readTokenCount(usageRecord, TOTAL_TOKEN_KEYS);
  const totalTokens =
    explicitTotalTokens ??
    (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);

  return { inputTokens, outputTokens, totalTokens };
}
