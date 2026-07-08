/**
 * Default value for the `workflow_stage_skill_policy` system
 * setting (EPIC-066 / work item
 * 88d7654e-ca93-4ffa-8ba5-7065db9506db).
 *
 * Split out of `system-settings.service.ts` so the service
 * file stays under the project's `max-lines` lint cap. The
 * default is a deep object keyed by lifecycle stage
 * (`discovery`, `decomposition`, `implementation`, `review`,
 * `merge`, `post_merge`) → agent profile name → skill selection
 * rule.
 *
 * Operators can override this default at runtime via the
 * `PUT /api/system-settings/workflow_stage_skill_policy`
 * endpoint; the override is read fresh on every skill-selection
 * call so changes take effect without a restart.
 */
export const EPIC_066_STAGE_SKILL_POLICY_DEFAULT = {
  discovery: {
    'ceo-agent': {
      include_skills: [],
      exclude_skills: [
        'test-driven-development',
        'refactoring',
        'dependency-updater',
      ],
      fallback_to_profile_skills: true,
    },
  },
  decomposition: {
    'ceo-agent': {
      include_skills: [],
      exclude_skills: [
        'test-driven-development',
        'refactoring',
        'dependency-updater',
      ],
      fallback_to_profile_skills: true,
    },
    'spec-generator': {
      include_skills: [],
      exclude_skills: ['dependency-updater'],
      fallback_to_profile_skills: true,
    },
  },
  implementation: {
    orchestrator: {
      include_skills: [
        'test-driven-development',
        'refactoring',
        'dependency-updater',
      ],
      fallback_to_profile_skills: true,
    },
    senior_dev: {
      include_skills: [
        'test-driven-development',
        'refactoring',
        'dependency-updater',
      ],
      fallback_to_profile_skills: true,
    },
    staff_engineer: {
      include_skills: [
        'test-driven-development',
        'refactoring',
        'dependency-updater',
      ],
      fallback_to_profile_skills: true,
    },
  },
  review: {
    qa_automation: {
      include_skills: ['test-driven-development'],
      exclude_skills: ['dependency-updater'],
      fallback_to_profile_skills: true,
    },
    'ceo-agent': {
      include_skills: [],
      fallback_to_profile_skills: true,
    },
  },
  merge: {
    staff_engineer: {
      include_skills: ['dependency-updater'],
      fallback_to_profile_skills: true,
    },
  },
  post_merge: {
    staff_engineer: {
      include_skills: ['dependency-updater'],
      fallback_to_profile_skills: true,
    },
  },
} as const;

/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the `workflow_stage_skill_policy`
 * system setting (EPIC-066 / work item 52666e94-e403-4d00-97ab-95a3cc8af256,
 * milestone 5).
 *
 * Single-key fragment that seeds `SYSTEM_SETTING_DEFAULTS` in
 * `apps/api/src/settings/system-settings.defaults.ts` via the
 * `...WORKFLOW_STAGE_SKILL_POLICY_SYSTEM_SETTING_DEFAULTS` spread site. The
 * default value references the runtime constant
 * `EPIC_066_STAGE_SKILL_POLICY_DEFAULT` defined above so the seeded registry
 * value stays byte-identical to the value the runtime skill-selection helper
 * (`WorkflowStageSkillPolicyService`) reads as `{}` fallback on a fresh
 * database.
 *
 * Operators can override this default at runtime via the
 * `PUT /api/system-settings/workflow_stage_skill_policy` endpoint; the
 * override is read fresh on every skill-selection call so changes take effect
 * without a restart.
 *
 * Extracted out of `system-settings.defaults.ts` so that registry module
 * stays under the project's `max-lines` lint cap while the single-source-of-
 * truth registry continues to grow across milestones. The fragment keeps the
 * seeded key + value + description byte-identical to the pre-refactor inline
 * registry; the `SystemSettingsService` exhaustive assertion at lines
 * 145-167 of `system-settings.service.spec.ts` is the safety net.
 */
export const WORKFLOW_STAGE_SKILL_POLICY_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  workflow_stage_skill_policy: {
    value: EPIC_066_STAGE_SKILL_POLICY_DEFAULT,
    description:
      'Optional lifecycle stage-to-skill policy map keyed by stage and agent profile for runtime skill selection.',
  },
};
