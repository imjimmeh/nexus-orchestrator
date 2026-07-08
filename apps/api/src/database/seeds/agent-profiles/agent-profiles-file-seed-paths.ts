import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveAgentsSeedRoot(
  configuredAgentsSeedRoot: string | null,
): string | undefined {
  const candidatePaths = [
    configuredAgentsSeedRoot,
    path.join(process.cwd(), 'seed', 'agents'),
    path.join(process.cwd(), '..', 'seed', 'agents'),
    path.join(process.cwd(), '..', '..', 'seed', 'agents'),
    path.resolve(__dirname, '../../../../../seed/agents'),
  ];

  return findExistingPath(candidatePaths);
}

export function resolveLegacyAssignmentsPath(
  configuredAssignmentsPath: string | null,
  legacyAssignmentsFile: string,
): string {
  const candidatePaths = [
    configuredAssignmentsPath,
    path.join(process.cwd(), 'seed', 'agents', legacyAssignmentsFile),
    path.join(process.cwd(), '..', 'seed', 'agents', legacyAssignmentsFile),
    path.join(
      process.cwd(),
      '..',
      '..',
      'seed',
      'agents',
      legacyAssignmentsFile,
    ),
    path.resolve(
      __dirname,
      `../../../../../seed/agents/${legacyAssignmentsFile}`,
    ),
  ];

  return findExistingPath(candidatePaths) ?? '';
}

export function listAgentDirectories(rootPath: string): string[] {
  return fs
    .readdirSync(rootPath)
    .filter((name) => fs.statSync(path.join(rootPath, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

export function listKnownSeedSkillNames(params: {
  configuredSkillsSeedRoot: string | null;
  skillMarkdownFile: string;
}): Set<string> {
  const root = resolveSkillsSeedRoot(params.configuredSkillsSeedRoot);
  if (!root) {
    return new Set<string>();
  }

  return new Set(
    fs
      .readdirSync(root)
      .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
      .filter((name) =>
        fs.existsSync(path.join(root, name, params.skillMarkdownFile)),
      ),
  );
}

function resolveSkillsSeedRoot(
  configuredSkillsSeedRoot: string | null,
): string | undefined {
  const candidatePaths = [
    configuredSkillsSeedRoot,
    path.join(process.cwd(), 'seed', 'skills'),
    path.join(process.cwd(), '..', 'seed', 'skills'),
    path.join(process.cwd(), '..', '..', 'seed', 'skills'),
    path.resolve(__dirname, '../../../../../seed/skills'),
  ];

  return findExistingPath(candidatePaths);
}

function findExistingPath(
  candidatePaths: Array<string | null | undefined>,
): string | undefined {
  return candidatePaths
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => fs.existsSync(candidate));
}
