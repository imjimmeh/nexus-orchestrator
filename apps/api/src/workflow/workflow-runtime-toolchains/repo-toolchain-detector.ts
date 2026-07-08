import type { ToolchainSpec } from '@nexus/core';

const LATEST = 'latest';

const add = (
  found: Map<string, string>,
  tool: string,
  version: string,
): void => {
  if (!found.has(tool)) found.set(tool, version);
};

function detectFromToolVersions(
  files: Record<string, string | null>,
  found: Map<string, string>,
): void {
  const body = files['.tool-versions'];
  if (!body) return;
  for (const line of body.split('\n')) {
    const [tool, version] = line.trim().split(/\s+/);
    if (tool && version) add(found, tool, version);
  }
}

function detectFromGoMod(
  files: Record<string, string | null>,
  found: Map<string, string>,
): void {
  const goMod = files['go.mod'];
  if (!goMod) return;
  const m = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(goMod);
  add(found, 'go', m ? m[1] : LATEST);
}

function detectFromPackageJson(
  files: Record<string, string | null>,
  found: Map<string, string>,
): void {
  const pkg = files['package.json'];
  if (!pkg) return;
  try {
    const engines = (JSON.parse(pkg) as { engines?: { node?: string } })
      .engines;
    add(found, 'node', engines?.node ?? LATEST);
  } catch {
    add(found, 'node', LATEST);
  }
}

function detectFromFilePresence(
  files: Record<string, string | null>,
  found: Map<string, string>,
): void {
  if (files['Cargo.toml']) add(found, 'rust', LATEST);
  if (files['requirements.txt'] || files['pyproject.toml'])
    add(found, 'python', LATEST);
  if (files['pom.xml']) add(found, 'java', LATEST);
}

/** Detection sources, evaluated in order; first hit per tool wins. */
function collect(files: Record<string, string | null>): Map<string, string> {
  const found = new Map<string, string>();
  detectFromToolVersions(files, found);
  detectFromGoMod(files, found);
  detectFromPackageJson(files, found);
  detectFromFilePresence(files, found);
  return found;
}

export function detectToolchainsFromFiles(
  files: Record<string, string | null>,
): ToolchainSpec[] {
  return [...collect(files).entries()]
    .map(([tool, version]) => ({ tool, version }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
}

/** Filenames the detector inspects — used by the IO wrapper to read the workspace. */
export const DETECTED_FILENAMES = [
  '.tool-versions',
  'go.mod',
  'package.json',
  'Cargo.toml',
  'requirements.txt',
  'pyproject.toml',
  'pom.xml',
] as const;
