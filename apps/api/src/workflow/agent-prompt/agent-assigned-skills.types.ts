import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';

/**
 * Structural surface of `WorkflowSkillBindingService` consumed by
 * {@link resolveAgentAssignedSkills}. Narrowed to a single method so both the
 * step-execution and subagent-provisioning paths can pass the real service
 * (or a test double) without importing the concrete class.
 */
export interface WorkflowSkillBindingLister {
  listForWorkflow(workflowName: string): Promise<WorkflowSkillBinding[]>;
}

/**
 * Structural surface of `AgentSkillsService` consumed by
 * {@link resolveAgentAssignedSkills} to look up full skill records for names
 * that only appear via a runtime binding or YAML declaration (not already
 * present in the caller's resolved profile-skill records).
 */
export interface SkillCatalogLister {
  listSkills(params?: { includeInactive?: boolean }): SkillLibraryRecord[];
}

/**
 * Inputs for resolving the effective, ordered, fully-hydrated skill set for
 * an agent (step or subagent). Mirrors `EffectiveSkillSources` (Task 3) but
 * carries full `SkillLibraryRecord`s for the profile layer (the only source
 * callers already have hydrated) and the services needed to fetch/hydrate
 * the remaining layers.
 */
export interface ResolveAgentAssignedSkillsParams {
  workflowSkillBindings: WorkflowSkillBindingLister;
  skillCatalog: SkillCatalogLister;
  /** Already-resolved profile-level skills (stage-policy + profile assignment). */
  profileSkills: SkillLibraryRecord[];
  /** Workflow definition name bindings are keyed by. Omitted skips the binding lookup. */
  workflowName?: string;
  /** Current step's YAML id, used to select step-scoped bindings. */
  stepId?: string;
  workflowYamlSkills?: string[];
  stepYamlSkills?: string[];
}
