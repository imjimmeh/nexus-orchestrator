import yaml from 'js-yaml';
import type { RuntimeSkillOrigin } from './skill-origin.types';

/**
 * Matches YAML frontmatter delimiters at the start of a markdown string.
 * Captures (group 1) the raw YAML body between the delimiters.
 */
const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

interface FrontmatterParts {
  yamlRaw: string;
  body: string;
}

function parseFrontmatter(markdown: string): FrontmatterParts | null {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return null;
  return { yamlRaw: match[1], body: markdown.slice(match[0].length) };
}

function parseFrontmatterObject(
  yamlRaw: string,
): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(yamlRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildNexusOriginBlock(
  origin: RuntimeSkillOrigin,
): Record<string, string> {
  const block: Record<string, string> = {
    source: origin.source,
    stamped_at: origin.stamped_at,
  };

  if (origin.source_proposal_id !== undefined) {
    block.source_proposal_id = origin.source_proposal_id;
  }

  if (origin.generated_from_run_id !== undefined) {
    block.generated_from_run_id = origin.generated_from_run_id;
  }

  return block;
}

/**
 * Injects or replaces the `nexus_origin` frontmatter block with the given
 * `RuntimeSkillOrigin`. Idempotent: re-stamping updates the existing block
 * in place rather than creating a second one. Returns the input unchanged
 * (fail-soft) when the markdown has no parseable frontmatter.
 */
export function stampRuntimeOrigin(
  markdown: string,
  origin: RuntimeSkillOrigin,
): string {
  const parts = parseFrontmatter(markdown);
  if (!parts) return markdown;

  const frontmatter = parseFrontmatterObject(parts.yamlRaw);
  if (!frontmatter) return markdown;

  const updated: Record<string, unknown> = {
    ...frontmatter,
    nexus_origin: buildNexusOriginBlock(origin),
  };

  const serialized = yaml.dump(updated, { lineWidth: -1 });
  return `---\n${serialized}---\n${parts.body}`;
}

/**
 * Reads the `nexus_origin` block from YAML frontmatter.
 * Returns `null` when the block is absent, has an unexpected `source` value,
 * is malformed, or the markdown has no parseable frontmatter.
 */
export function readRuntimeOrigin(markdown: string): RuntimeSkillOrigin | null {
  const parts = parseFrontmatter(markdown);
  if (!parts) return null;

  const frontmatter = parseFrontmatterObject(parts.yamlRaw);
  if (!frontmatter) return null;

  const raw = frontmatter.nexus_origin;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const block = raw as Record<string, unknown>;
  if (block.source !== 'agent_factory') return null;

  const stampedAt = block.stamped_at;
  if (typeof stampedAt !== 'string') return null;

  const result: RuntimeSkillOrigin = {
    source: 'agent_factory',
    stamped_at: stampedAt,
  };

  if (typeof block.source_proposal_id === 'string') {
    result.source_proposal_id = block.source_proposal_id;
  }

  if (typeof block.generated_from_run_id === 'string') {
    result.generated_from_run_id = block.generated_from_run_id;
  }

  return result;
}

/**
 * Returns `true` when the skill was authored by the agent runtime
 * (`nexus_origin.source === 'agent_factory'`), `false` for seed/admin skills.
 */
export function isRuntimeAuthored(markdown: string): boolean {
  return readRuntimeOrigin(markdown)?.source === 'agent_factory';
}
