import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';

export const WORKFLOW_LIFECYCLE_STAGES = [
  'discovery',
  'decomposition',
  'implementation',
  'review',
  'merge',
  'post_merge',
  'import_assessment',
  'import_ready',
] as const;

export type WorkflowLifecycleStage = (typeof WORKFLOW_LIFECYCLE_STAGES)[number];

export const WORKFLOW_STAGE_SKILL_POLICY_SOURCES = [
  'profile',
  'stage_policy',
  'stage_policy_with_profile_fallback',
  'invalid_policy',
] as const;

export type WorkflowStageSkillPolicySource =
  (typeof WORKFLOW_STAGE_SKILL_POLICY_SOURCES)[number];

export interface WorkflowStageSkillPolicyProfileRule {
  include_skills?: string[];
  exclude_skills?: string[];
  fallback_to_profile_skills?: boolean;
}

export interface WorkflowStageSkillSelection {
  stage: WorkflowLifecycleStage | null;
  policySource: WorkflowStageSkillPolicySource;
  fallbackToProfileSkills: boolean;
  policyMatched: boolean;
  missingOrInvalidPolicy: boolean;
  includedSkillNames: string[];
  excludedSkillNames: string[];
  skills: SkillLibraryRecord[];
}
