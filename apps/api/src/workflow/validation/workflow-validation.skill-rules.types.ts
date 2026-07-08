/**
 * Narrow surface of `AgentSkillsService` `validateSkillReferences`
 * (`workflow-validation.skill-rules.ts`) depends on — mirrors
 * `SkillCatalogLister` (`agent-prompt/agent-assigned-skills.types.ts`) so the
 * validator can accept either the real service or a test double without
 * importing the concrete class.
 */
export interface SkillExistenceCatalog {
  listSkills(params?: { includeInactive?: boolean }): { name: string }[];
}
