import type { SkillDiscoveryMode } from '@nexus/core';
import type { SkillSectionSkill } from './skill-catalog-prompt.helpers.types';

const SKILL_DISCOVERY_GUIDANCE =
  'Skill discovery:\nUse `search_skills` to find relevant guidance by query, category, or tags before choosing a skill. Do not call `read_file`, `search_file`, or `read_skill_file` unless those tools are explicitly listed in the current tool set.';

/**
 * Render the assigned-skill portion of an agent system prompt.
 * Returns '' when there is nothing to add (caller decides how to append).
 *
 * - `native`: list the assigned skills directly; the agent loads full content
 *   via `read_skill_manifest`. No category line (the agent sees its full set).
 * - `search`: emit the legacy discovery guidance + the available categories.
 */
export function renderSkillSection(params: {
  mode: SkillDiscoveryMode;
  assignedSkills: SkillSectionSkill[] | undefined;
  availableCategories?: string[];
}): string {
  const skills = params.assignedSkills ?? [];
  const hasAssigned = skills.length > 0;

  if (params.mode === 'native') {
    if (!hasAssigned) {
      return '';
    }
    const lines = skills
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (s) => `- ${s.name} — ${s.description}${s.id ? ` (id: ${s.id})` : ''}`,
      );
    return [
      'Assigned skills (use `read_skill_manifest` with the skill id to load full instructions):',
      ...lines,
    ].join('\n');
  }

  // search mode (legacy behavior)
  const categories = params.availableCategories ?? [];
  const hasCategories = categories.length > 0;
  if (!hasAssigned && !hasCategories) {
    return '';
  }
  const sections: string[] = [];
  if (hasAssigned) {
    sections.push(SKILL_DISCOVERY_GUIDANCE);
  }
  if (hasCategories) {
    sections.push(
      `Available skill categories include: ${categories.join(', ')}.`,
    );
  }
  return sections.join('\n\n');
}
