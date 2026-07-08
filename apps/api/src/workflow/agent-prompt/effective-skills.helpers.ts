import { normalizeSkillName } from '../workflow-stage-skill-policy.helpers';
import type {
  EffectiveSkill,
  EffectiveSkillSources,
  SkillSpecificity,
} from './effective-skills.types';

/**
 * Shared effective-skill resolution helper.
 *
 * Single source of truth for computing the union of skills an agent should
 * receive, used identically by both the step-execution path and the
 * subagent-provisioning path. This is the fix for the recurring "step vs
 * subagent path divergence" bug: previously each path re-implemented its
 * own skill-gathering logic and could silently diverge.
 *
 * Pure function: callers are responsible for fetching profile skills,
 * workflow/step YAML skill lists, and workflow/step skill bindings from
 * their respective sources and passing them in. No DB/IO happens here.
 */

const SPECIFICITY_RANK: Record<SkillSpecificity, number> = {
  step: 0,
  workflow: 1,
  profile: 2,
};

/**
 * Unions profile, workflow, and step skill sources, deduping by NORMALIZED
 * skill name (the same normalization hydration applies — see
 * `normalizeSkillName`) so naming variants like `test_generator` and
 * `test-generator` (or case differences) collapse to a single effective
 * skill instead of injecting the same skill's content twice. When a
 * (normalized) skill name appears in more than one source, it is tagged
 * with its most-specific origin (step > workflow > profile). The result is
 * ordered most-specific-first (step, then workflow, then profile) so that
 * an injection-token budget fills the most specific skills first.
 */
export function resolveEffectiveSkills(
  sources: EffectiveSkillSources,
): EffectiveSkill[] {
  const mostSpecificBySkillName = new Map<string, SkillSpecificity>();

  const considerNames = (
    names: string[],
    specificity: SkillSpecificity,
  ): void => {
    for (const rawName of names) {
      const name = normalizeSkillName(rawName);
      if (!name) continue;
      const currentSpecificity = mostSpecificBySkillName.get(name);
      if (
        currentSpecificity === undefined ||
        SPECIFICITY_RANK[specificity] < SPECIFICITY_RANK[currentSpecificity]
      ) {
        mostSpecificBySkillName.set(name, specificity);
      }
    }
  };

  considerNames(sources.stepYamlSkills, 'step');
  considerNames(sources.stepBindings, 'step');
  considerNames(sources.workflowYamlSkills, 'workflow');
  considerNames(sources.workflowBindings, 'workflow');
  considerNames(sources.profileSkills, 'profile');

  return [...mostSpecificBySkillName.entries()]
    .map(([name, specificity]) => ({ name, specificity }))
    .sort(
      (a, b) =>
        SPECIFICITY_RANK[a.specificity] - SPECIFICITY_RANK[b.specificity],
    );
}
