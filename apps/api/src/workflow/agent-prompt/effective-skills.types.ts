/**
 * Raw skill-name sources considered when resolving the effective skill set
 * for an agent, from least to most specific: profile-level defaults,
 * workflow-level YAML/binding overrides, and step-level YAML/binding
 * overrides.
 */
export interface EffectiveSkillSources {
  profileSkills: string[];
  workflowYamlSkills: string[];
  stepYamlSkills: string[];
  workflowBindings: string[];
  stepBindings: string[];
}

/**
 * Origin of a resolved skill, most specific first. Used to rank skills when
 * filling a bounded injection-token budget.
 */
export type SkillSpecificity = 'step' | 'workflow' | 'profile';

/** A skill name paired with its most-specific origin. */
export interface EffectiveSkill {
  name: string;
  specificity: SkillSpecificity;
}
