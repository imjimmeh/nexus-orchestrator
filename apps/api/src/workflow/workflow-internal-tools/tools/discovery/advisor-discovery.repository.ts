import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiscoverySearchParams } from './advisor-discovery.repository.types';

type DiscoveryKind = 'skills' | 'playbooks';
type ManifestKind = 'skill' | 'playbook';

type SeedManifest = {
  name: string;
  description: string | null;
  relativePath: string;
  content: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SKILL_FILE_NAME = 'SKILL.md';
const SEED_SKILLS_PATH = path.join('seed', 'skills');
const PLAYBOOKS_PREFIX = 'seed/skills/orchestration-playbooks/';

export async function searchSeedManifests(
  kind: DiscoveryKind,
  params: DiscoverySearchParams,
): Promise<Record<string, unknown>> {
  const query = normalizeQuery(params.query);
  const limit = normalizeLimit(params.limit);
  const offset = normalizeOffset(params.offset);
  const manifests = await loadSeedManifests(kind);
  const filtered = manifests.filter((manifest) =>
    matchesQuery(manifest, query),
  );
  const page = filtered.slice(offset, offset + limit).map(toManifestSummary);

  return {
    query,
    limit,
    offset,
    total: filtered.length,
    [kind]: page,
  };
}

export async function readSeedManifest(
  kind: ManifestKind,
  identifier: string | null,
): Promise<Record<string, unknown>> {
  const normalizedIdentifier = normalizeQuery(identifier ?? undefined);
  const manifests = await loadSeedManifests(
    kind === 'skill' ? 'skills' : 'playbooks',
  );
  const manifest = manifests.find((candidate) =>
    matchesIdentifier(candidate, normalizedIdentifier),
  );

  if (!manifest) {
    return {
      found: false,
      [kind]: null,
      identifier,
    };
  }

  return {
    found: true,
    [kind]: manifest,
  };
}

async function loadSeedManifests(kind: DiscoveryKind): Promise<SeedManifest[]> {
  const repoRoot = await findRepoRoot();
  const seedSkillsRoot = path.join(repoRoot, SEED_SKILLS_PATH);
  const files = await collectSkillFiles(seedSkillsRoot);
  const manifests = await Promise.all(
    files.map((filePath) => parseManifest(repoRoot, filePath)),
  );

  if (kind === 'playbooks') {
    return manifests.filter((manifest) =>
      manifest.relativePath.startsWith(PLAYBOOKS_PREFIX),
    );
  }

  return manifests;
}

async function findRepoRoot(): Promise<string> {
  let current = process.cwd();

  while (true) {
    try {
      await fs.access(path.join(current, SEED_SKILLS_PATH));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(process.cwd(), '..', '..');
      }
      current = parent;
    }
  }
}

async function collectSkillFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
      files.push(entryPath);
    }
  }

  return files;
}

async function parseManifest(
  repoRoot: string,
  filePath: string,
): Promise<SeedManifest> {
  const content = await fs.readFile(filePath, 'utf8');
  const relativePath = toPosixPath(path.relative(repoRoot, filePath));
  const frontmatter = extractFrontmatter(content);

  return {
    name: frontmatter.name ?? path.basename(path.dirname(filePath)),
    description: frontmatter.description ?? null,
    relativePath,
    content,
  };
}

function extractFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(content);
  if (!match?.groups?.body) {
    return {};
  }

  return {
    name: readFrontmatterValue(match.groups.body, 'name'),
    description: readFrontmatterValue(match.groups.body, 'description'),
  };
}

function readFrontmatterValue(body: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'imu').exec(body);
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
}

function toManifestSummary(manifest: SeedManifest): Record<string, unknown> {
  return {
    name: manifest.name,
    description: manifest.description,
    relativePath: manifest.relativePath,
  };
}

function matchesQuery(manifest: SeedManifest, query: string | null): boolean {
  if (!query) {
    return true;
  }

  return normalizeSearchText(searchableText(manifest)).includes(
    normalizeSearchText(query),
  );
}

function matchesIdentifier(
  manifest: SeedManifest,
  identifier: string | null,
): boolean {
  if (!identifier) {
    return false;
  }

  return (
    manifest.name.toLowerCase() === identifier ||
    manifest.relativePath.toLowerCase() === identifier ||
    path.basename(path.dirname(manifest.relativePath)).toLowerCase() ===
      identifier
  );
}

function searchableText(manifest: SeedManifest): string {
  return [
    manifest.name,
    manifest.description,
    manifest.relativePath,
    manifest.content,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase();
}

function normalizeQuery(query: string | undefined): string | null {
  return typeof query === 'string' && query.trim().length > 0
    ? query.trim().toLowerCase()
    : null;
}

function normalizeSearchText(value: string): string {
  return value.replace(/[-_]+/gu, ' ');
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  return typeof offset === 'number' && Number.isInteger(offset) && offset > 0
    ? offset
    : 0;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
