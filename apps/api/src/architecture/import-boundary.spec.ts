import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { temporaryImportBoundaryExceptions } from './import-boundary.exceptions';
import type {
  ImportBoundaryDomain,
  ImportBoundaryEdge,
  ImportBoundaryException,
} from './import-boundary.types';

const apiSrcRoot = path.resolve(__dirname, '..');
const trackedDomainPairs = new Set([
  'control-plane->external-domain',
  'control-plane->chat-domain',
  'external-domain->control-plane',
  'chat-domain->control-plane',
  'external-domain->chat-domain',
  'chat-domain->external-domain',
]);
const importPattern =
  /^\s*(?:import|export)\s+(?:[^'"`;]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
const importBoundaryScanTimeoutMs = 120_000;

describe('Import boundary architecture guardrails', () => {
  it('contains only unexpired temporary exceptions', () => {
    const today = new Date().toISOString().slice(0, 10);
    const expired = temporaryImportBoundaryExceptions.filter(
      (entry) => entry.expiresOn < today,
    );

    if (expired.length > 0) {
      throw new Error(
        [
          'Found expired import-boundary exceptions:',
          ...expired.map(
            (entry) =>
              `- ${entry.sourceFile} -> ${entry.targetFile} (expired ${entry.expiresOn}, owner ${entry.owner})`,
          ),
        ].join('\n'),
      );
    }

    expect(expired).toHaveLength(0);
  });

  it(
    'fails when cross-domain imports are not explicitly allowlisted',
    async () => {
      const observedEdges = await collectCrossDomainEdges();
      const observedEdgeKeys = new Set(observedEdges.map(toEdgeKey));
      const exceptionKeys = new Set(
        temporaryImportBoundaryExceptions.map(toExceptionKey),
      );

      const missingExceptions = observedEdges.filter(
        (edge) => !exceptionKeys.has(toEdgeKey(edge)),
      );
      const staleExceptions = temporaryImportBoundaryExceptions.filter(
        (entry) => !observedEdgeKeys.has(toExceptionKey(entry)),
      );

      if (missingExceptions.length > 0 || staleExceptions.length > 0) {
        const lines: string[] = ['Import boundary violations detected.', ''];

        if (missingExceptions.length > 0) {
          lines.push('Unallowlisted cross-domain imports:');
          for (const edge of missingExceptions) {
            lines.push(
              `- ${edge.sourceFile} -> ${edge.targetFile} (${edge.fromDomain} -> ${edge.toDomain})`,
            );
          }
          lines.push('');
        }

        if (staleExceptions.length > 0) {
          lines.push('Stale exception entries (remove from allowlist):');
          for (const entry of staleExceptions) {
            lines.push(
              `- ${entry.sourceFile} -> ${entry.targetFile} (${entry.fromDomain} -> ${entry.toDomain})`,
            );
          }
        }

        throw new Error(lines.join('\n'));
      }

      expect(missingExceptions).toHaveLength(0);
      expect(staleExceptions).toHaveLength(0);
    },
    importBoundaryScanTimeoutMs,
  );
});

function toEdgeKey(edge: ImportBoundaryEdge): string {
  return `${edge.sourceFile}|${edge.targetFile}|${edge.fromDomain}|${edge.toDomain}`;
}

function toExceptionKey(entry: ImportBoundaryException): string {
  return `${entry.sourceFile}|${entry.targetFile}|${entry.fromDomain}|${entry.toDomain}`;
}

function toPosixRelativePath(filePath: string): string {
  return path.relative(apiSrcRoot, filePath).replace(/\\/g, '/');
}

function resolveDomainFromPath(filePath: string): ImportBoundaryDomain | null {
  const relativePath = toPosixRelativePath(filePath);
  const topLevelSegment = relativePath.split('/')[0];
  if (topLevelSegment === 'workflow') {
    return 'control-plane';
  }
  if (topLevelSegment === 'project' || topLevelSegment === 'project-goals') {
    return 'external-domain';
  }
  if (topLevelSegment === 'session') {
    return 'chat-domain';
  }
  return null;
}

function isTrackedPair(
  fromDomain: ImportBoundaryDomain,
  toDomain: ImportBoundaryDomain,
): boolean {
  return trackedDomainPairs.has(`${fromDomain}->${toDomain}`);
}

function parseRelativeImportSpecifiers(sourceText: string): string[] {
  const specifiers: string[] = [];
  importPattern.lastIndex = 0;

  for (const match of sourceText.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

async function listSourceFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const resolvedPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') {
        continue;
      }
      const nestedFiles = await listSourceFiles(resolvedPath);
      results.push(...nestedFiles);
      continue;
    }

    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    if (
      entry.name.endsWith('.d.ts') ||
      entry.name.endsWith('.spec.ts') ||
      entry.name.endsWith('.e2e-spec.ts')
    ) {
      continue;
    }

    results.push(resolvedPath);
  }

  return results;
}

async function resolveRelativeImportPath(
  sourceFilePath: string,
  importSpecifier: string,
): Promise<string | null> {
  const basePath = path.resolve(path.dirname(sourceFilePath), importSpecifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue trying next candidate.
    }
  }

  return null;
}

async function collectCrossDomainEdges(): Promise<ImportBoundaryEdge[]> {
  const sourceFiles = await listSourceFiles(apiSrcRoot);
  const edges: ImportBoundaryEdge[] = [];
  const uniqueKeys = new Set<string>();

  for (const sourceFilePath of sourceFiles) {
    const fromDomain = resolveDomainFromPath(sourceFilePath);
    if (!fromDomain) {
      continue;
    }

    const sourceText = await readFile(sourceFilePath, 'utf8');
    const importSpecifiers = parseRelativeImportSpecifiers(sourceText);

    for (const importSpecifier of importSpecifiers) {
      const targetFilePath = await resolveRelativeImportPath(
        sourceFilePath,
        importSpecifier,
      );
      if (!targetFilePath) {
        continue;
      }

      const toDomain = resolveDomainFromPath(targetFilePath);
      if (!toDomain || toDomain === fromDomain) {
        continue;
      }
      if (!isTrackedPair(fromDomain, toDomain)) {
        continue;
      }

      const edge: ImportBoundaryEdge = {
        sourceFile: toPosixRelativePath(sourceFilePath),
        targetFile: toPosixRelativePath(targetFilePath),
        fromDomain,
        toDomain,
      };
      const edgeKey = toEdgeKey(edge);
      if (uniqueKeys.has(edgeKey)) {
        continue;
      }

      uniqueKeys.add(edgeKey);
      edges.push(edge);
    }
  }

  edges.sort((left, right) => {
    const sourceCompare = left.sourceFile.localeCompare(right.sourceFile);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }
    return left.targetFile.localeCompare(right.targetFile);
  });

  return edges;
}
