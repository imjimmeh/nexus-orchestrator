import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import type { ParsedSpec } from './publish-specs-parser.types';

const FRONTMATTER_DELIMITER = '---';
const VALID_SCOPES = new Set(['standard', 'large']);
const CANONICAL_SOURCE_ID_FIELD = 'resource_id';
const DEPENDS_ON_SOURCE_ID_FIELDS = ['depends_on_resource_ids', 'depends_on'];

export function parseSpecFile(
  fileName: string,
  content: string,
  onWarning?: (message: string) => void,
  sourcePathOverride?: string,
): ParsedSpec | null {
  const slug = fileName.replace(/\.md$/i, '');
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) {
    onWarning?.(
      `${fileName}: missing YAML frontmatter delimited by ${FRONTMATTER_DELIMITER}`,
    );
    return null;
  }

  const body = extractBody(content);
  const scope = parseSpecScope(frontmatter, slug, body, onWarning);

  let sourceId = parseCanonicalSourceId(frontmatter);
  if (!sourceId) {
    sourceId = slug;
    onWarning?.(
      `${fileName}: missing frontmatter field "resource_id"; defaulting to filename slug "${slug}"`,
    );
  }

  const title = parseSpecTitle(frontmatter);
  if (!title) {
    onWarning?.(`${fileName}: missing required frontmatter field "title"`);
    return null;
  }

  const dependsOnSourceIds = parseDependsOnSourceIds(
    frontmatter,
    sourceId,
    onWarning,
    fileName,
  );

  const sourcePath = (sourcePathOverride ?? fileName).replaceAll('\\', '/');
  const sourceHash = createHash('sha256').update(content, 'utf8').digest('hex');

  return {
    sourceId,
    slug,
    sourcePath,
    sourceHash,
    scope,
    title,
    dependsOnSourceIds,
    body,
    filePath: fileName,
  };
}

function parseCanonicalSourceId(
  frontmatter: Record<string, unknown>,
): string | null {
  const sourceId = readTrimmedString(frontmatter[CANONICAL_SOURCE_ID_FIELD]);
  if (!sourceId) {
    return null;
  }

  return sourceId;
}

function parseDependsOnSourceIds(
  frontmatter: Record<string, unknown>,
  sourceId: string,
  onWarning: ((message: string) => void) | undefined,
  fileName: string,
): string[] | undefined {
  const rawValue = DEPENDS_ON_SOURCE_ID_FIELDS.map(
    (field) => frontmatter[field],
  ).find((value) => value !== undefined);

  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  const sourceIds = normalizeSourceIdList(rawValue);
  if (sourceIds === null) {
    onWarning?.(
      `${fileName}: dependency field must be a comma-delimited string or string array`,
    );
    return undefined;
  }

  const deduped = Array.from(
    new Set(sourceIds.filter((entry) => entry !== sourceId)),
  );
  if (sourceIds.some((entry) => entry === sourceId)) {
    onWarning?.(
      `${fileName}: dependency list cannot include its own resource_id (${sourceId})`,
    );
  }

  return deduped.length > 0 ? deduped : undefined;
}

function parseSpecScope(
  frontmatter: Record<string, unknown>,
  slug: string,
  body: string,
  onWarning?: (message: string) => void,
): 'standard' | 'large' {
  const scope = readTrimmedString(frontmatter.scope)?.toLowerCase();
  if (!scope) {
    return inferScope(body);
  }

  if (!VALID_SCOPES.has(scope)) {
    onWarning?.(`${slug}: invalid scope "${scope}", defaulting to "standard"`);
    return 'standard';
  }

  return scope as 'standard' | 'large';
}

function inferScope(body: string): 'standard' | 'large' {
  const deliverableCount = countDeliverableSections(body);
  const estimatedFileCount = estimateFilesReferenced(body);
  const hasMultipleModules = detectModuleBoundaries(body);
  const bodyLength = body.length;

  if (
    deliverableCount > 3 ||
    estimatedFileCount > 10 ||
    hasMultipleModules ||
    bodyLength > 5000
  ) {
    return 'large';
  }
  return 'standard';
}

function countDeliverableSections(body: string): number {
  const deliverablesSectionMatch = body.match(/##\s+Deliverables/i);
  if (
    !deliverablesSectionMatch ||
    deliverablesSectionMatch.index === undefined
  ) {
    return 0;
  }

  const bodyAfterDeliverables = body.slice(deliverablesSectionMatch.index);

  const nextH2Match = bodyAfterDeliverables.slice(15).match(/\n##\s/);
  const textInDeliverables =
    nextH2Match && nextH2Match.index !== undefined
      ? bodyAfterDeliverables.slice(0, 15 + nextH2Match.index)
      : bodyAfterDeliverables;

  const matches = textInDeliverables.match(/^###\s/gm);
  return matches ? matches.length : 0;
}

function estimateFilesReferenced(body: string): number {
  const matches = body.match(
    /([a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+/g,
  );
  if (!matches) {
    return 0;
  }
  return new Set(matches).size;
}

function detectModuleBoundaries(body: string): boolean {
  const matches = body.match(/(apps|packages)\/[a-zA-Z0-9_-]+/g);
  if (!matches) {
    return false;
  }
  const uniqueModules = new Set(matches);
  return uniqueModules.size > 1;
}

function parseSpecTitle(frontmatter: Record<string, unknown>): string | null {
  const title = readTrimmedString(frontmatter.title);
  return title || null;
}

function extractFrontmatter(content: string): Record<string, unknown> | null {
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return null;
  }

  const parsed = yaml.load(frontmatterBlock);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

function extractFrontmatterBlock(content: string): string | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*/.exec(content.trim());
  if (!match) {
    return null;
  }

  const block = match[1]?.trim();
  return block ? block : null;
}

function extractBody(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return trimmed;
  }

  const match = /^---\s*\n[\s\S]*?\n---\s*([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  return (match[1] ?? '').trim();
}

function normalizeSourceIdList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return normalized;
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return null;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
