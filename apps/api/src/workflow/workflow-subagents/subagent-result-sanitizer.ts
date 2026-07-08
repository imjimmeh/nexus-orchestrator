const THINKING_BLOCK_PATTERN =
  /<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function stripThinkingBlocks(value: string): string {
  return value.replace(THINKING_BLOCK_PATTERN, '');
}

export function sanitizeSubagentResult(result: string): string;
export function sanitizeSubagentResult(result: unknown[]): unknown[];
export function sanitizeSubagentResult(
  result: Record<string, unknown>,
): Record<string, unknown>;
export function sanitizeSubagentResult<T>(result: T): T;
export function sanitizeSubagentResult(result: unknown): unknown {
  if (typeof result === 'string') {
    return stripThinkingBlocks(result);
  }

  if (Array.isArray(result)) {
    return result.map((entry: unknown) => sanitizeSubagentResult(entry));
  }

  if (!isPlainRecord(result)) {
    return result;
  }

  const sanitizedEntries: Array<[string, unknown]> = Object.entries(result).map(
    ([key, value]) => [key, sanitizeSubagentResult(value)],
  );

  return Object.fromEntries(sanitizedEntries);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
