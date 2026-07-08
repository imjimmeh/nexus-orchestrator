import type { LegacyAssignmentsSeed } from './agent-profiles-file-seed.types';

export function parseLegacyAssignments(params: {
  assignments: LegacyAssignmentsSeed;
  skillNamePattern: RegExp;
  warn: (message: string) => void;
}): Map<string, string[]> {
  const output = new Map<string, string[]>();

  const profileNames = Object.keys(params.assignments).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const profileName of profileNames) {
    const normalizedSkills = normalizeLegacySkillList({
      raw: params.assignments[profileName],
      profileName,
      skillNamePattern: params.skillNamePattern,
      warn: params.warn,
    });

    if (!normalizedSkills) {
      continue;
    }

    output.set(profileName, normalizedSkills);
  }

  return output;
}

function normalizeLegacySkillList(params: {
  raw: unknown;
  profileName: string;
  skillNamePattern: RegExp;
  warn: (message: string) => void;
}): string[] | null {
  if (!Array.isArray(params.raw)) {
    params.warn(
      `Ignoring legacy skill assignment for ${params.profileName}: value must be an array`,
    );
    return null;
  }

  const normalized: string[] = [];
  for (const value of params.raw) {
    if (typeof value !== 'string') {
      params.warn(
        `Ignoring non-string legacy skill assignment for ${params.profileName}`,
      );
      continue;
    }

    const skillName = value.trim().toLowerCase();
    if (!skillName || !params.skillNamePattern.test(skillName)) {
      continue;
    }

    if (!normalized.includes(skillName)) {
      normalized.push(skillName);
    }
  }

  return normalized;
}
