import { isRecord } from "./type-guards";
import type { NormalizedToolContent } from "./tool-result-content.types";

const MAX_UNWRAP_DEPTH = 8;
const TEXT_BLOCK_SEPARATOR = "\n";

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function isContentBlockArray(
  value: unknown,
): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isRecord(entry))
  );
}

function joinTextBlocks(blocks: Record<string, unknown>[]): string | null {
  const texts = blocks
    .filter((block) => typeof block.text === "string")
    .map((block) => block.text as string);
  return texts.length > 0 ? texts.join(TEXT_BLOCK_SEPARATOR) : null;
}

function fromText(text: string, depth: number): NormalizedToolContent {
  if (text.trim().length === 0) return { kind: "empty" };
  if (depth < MAX_UNWRAP_DEPTH && looksLikeJson(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "string") {
        return normalizeToolResult(parsed, depth + 1);
      }
    } catch {
      // Not valid JSON after all — fall through to plain text.
    }
  }
  return { kind: "text", text };
}

export function normalizeToolResult(
  value: unknown,
  depth = 0,
): NormalizedToolContent {
  if (value === undefined || value === null) return { kind: "empty" };
  if (typeof value === "string") return fromText(value, depth);

  if (isContentBlockArray(value)) {
    const joined = joinTextBlocks(value);
    if (joined !== null) return fromText(joined, depth);
    return { kind: "json", value };
  }

  if (isRecord(value) && isContentBlockArray(value.content)) {
    const joined = joinTextBlocks(value.content);
    if (joined !== null) return fromText(joined, depth);
  }

  return { kind: "json", value };
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Shallow text extraction for tools whose output is raw text (read, bash, ls,
 * grep, find): unwraps the content-block envelope but, unlike
 * {@link normalizeToolResult}, never re-parses the inner text as JSON so the
 * literal output (file contents, stdout) is preserved verbatim.
 */
export function extractToolResultText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (isContentBlockArray(value)) {
    return joinTextBlocks(value) ?? prettyJson(value);
  }
  if (isRecord(value) && isContentBlockArray(value.content)) {
    const joined = joinTextBlocks(value.content);
    if (joined !== null) return joined;
  }
  return prettyJson(value);
}

/**
 * Convenience wrapper that flattens a normalized result to a single string for
 * `<pre>` rendering: text verbatim, structured values pretty-printed.
 */
export function toDisplayText(value: unknown): string {
  const normalized = normalizeToolResult(value);
  if (normalized.kind === "text") return normalized.text;
  if (normalized.kind === "json") return prettyJson(normalized.value);
  return "";
}
