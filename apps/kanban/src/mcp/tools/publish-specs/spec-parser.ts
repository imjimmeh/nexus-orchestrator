import { createHash } from "node:crypto";
import type { SpecParseResult } from "./spec-parser.types";
export type { SpecParseResult } from "./spec-parser.types";

const FRONTMATTER_DELIMITER = "---";

const SUPPORTED_STATUSES = new Set([
  "backlog",
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "blocked",
  "done",
]);

export function parseSpecFile(
  fileName: string,
  content: string,
  sourcePath: string,
): SpecParseResult {
  const frontmatter = extractFrontmatter(content);
  const body = extractBody(content);
  const sourceId =
    optionalString(frontmatter, "item_id") ?? fileName.replace(/\.md$/i, "");
  const itemId = optionalString(frontmatter, "item_id");
  const title = requireString(frontmatter, "title");
  const priority = optionalString(frontmatter, "priority") ?? "p2";
  const scopeValue = optionalString(frontmatter, "scope");
  const scope = scopeValue === "large" ? "large" : "standard";
  const status = optionalStatus(frontmatter);
  const executionConfig = buildExecutionConfig(frontmatter);
  const metadataKeys = Object.keys(frontmatter).filter(
    (key) => !RESERVED_KEYS.has(key),
  );
  const metadata: Record<string, unknown> | undefined =
    metadataKeys.length > 0
      ? Object.fromEntries(metadataKeys.map((key) => [key, frontmatter[key]]))
      : undefined;
  return {
    sourceId,
    itemId,
    title,
    priority,
    scope,
    ...(status ? { status } : {}),
    body,
    sourcePath,
    sourceHash: createHash("sha256").update(content, "utf8").digest("hex"),
    ...(executionConfig ? { executionConfig } : {}),
    ...(metadata ? { metadata } : {}),
    dependsOnSourceIds: parseDependsOnSourceIds(frontmatter),
  };
}

export function extractFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\s*\n([\s\S]*?)\n---\s*/.exec(content.trim());
  if (!match?.[1]) {
    throw new Error(
      `Spec file is missing ${FRONTMATTER_DELIMITER} frontmatter`,
    );
  }
  return parseFrontmatterBlock(match[1]);
}

export function parseFrontmatterBlock(
  frontmatter: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || line.startsWith("-")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      result[line] = "";
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (value.length > 0) {
      result[key] = parseFrontmatterScalar(value);
      continue;
    }

    const listValues: string[] = [];
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1] ?? "";
      const listItemMatch = /^\s*-\s*(.+?)\s*$/.exec(nextLine);
      if (!listItemMatch?.[1]) break;
      listValues.push(parseFrontmatterScalar(listItemMatch[1]));
      index += 1;
    }
    result[key] = listValues.length > 0 ? listValues : "";
  }
  return result;
}

export function parseFrontmatterScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function extractBody(content: string): string {
  const match = /^---\s*\n[\s\S]*?\n---\s*([\s\S]*)$/.exec(content.trim());
  return (match?.[1] ?? content).trim();
}

export function parseDependsOnSourceIds(
  frontmatter: Record<string, unknown>,
): string[] {
  const value = frontmatter.depends_on ?? frontmatter.depends_on_item_ids;
  if (Array.isArray(value)) {
    return normalizeStringList(value);
  }
  if (typeof value !== "string") {
    return [];
  }
  return splitStringList(value);
}

function normalizeStringList(values: unknown[]): string[] {
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => splitStringList(entry));
}

function splitStringList(value: string): string[] {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  return unwrapped
    .split(",")
    .map((entry) => parseFrontmatterScalar(entry).trim())
    .filter((entry) => entry.length > 0);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalStatus(
  args: Record<string, unknown>,
): SpecParseResult["status"] {
  const value = optionalString(args, "status");
  return value && SUPPORTED_STATUSES.has(value)
    ? (value as SpecParseResult["status"])
    : undefined;
}

function optionalStringList(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (Array.isArray(value)) {
    const entries = normalizeStringList(value);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const entries = splitStringList(value);
    return entries.length > 0 ? entries : undefined;
  }
  return undefined;
}

const RESERVED_KEYS = new Set([
  "item_id",
  "title",
  "priority",
  "scope",
  "status",
  "depends_on",
  "depends_on_item_ids",
  "agent_profile",
  "base_branch",
  "target_branch",
  "context_files",
]);

function buildExecutionConfig(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const entries: Array<[string, unknown]> = [];
  const agentProfileId = optionalString(frontmatter, "agent_profile");
  if (agentProfileId) entries.push(["agentProfileId", agentProfileId]);
  const baseBranch = optionalString(frontmatter, "base_branch");
  if (baseBranch) entries.push(["baseBranch", baseBranch]);
  const targetBranch = optionalString(frontmatter, "target_branch");
  if (targetBranch) entries.push(["targetBranch", targetBranch]);
  const contextFiles = optionalStringList(frontmatter, "context_files");
  if (contextFiles) entries.push(["contextFiles", contextFiles]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
