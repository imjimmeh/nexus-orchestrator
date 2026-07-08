import type { AssignmentTarget } from '@nexus/core';

/**
 * Dependencies {@link import('./skill-create.applier').applySkillAssignments}
 * needs to route a resolved {@link AssignmentTarget} to its destination.
 * Kept as a narrow structural interface (rather than importing the concrete
 * services) so the function stays unit-testable without a Nest DI context;
 * the completion listener wires the real
 * {@link import('../../ai-config/services/agent-skills.service').AgentSkillsService}
 * and {@link import('../../workflow/workflow-skill-bindings/workflow-skill-binding.service').WorkflowSkillBindingService}
 * against it.
 */
export interface SkillAssignmentDeps {
  skills: {
    addProfileSkills(profileName: string, skillNames: string[]): Promise<void>;
    addScopedProfileSkill(input: {
      profileName: string;
      skillName: string;
      scopeNodeId: string;
    }): Promise<void>;
  };
  bindings: {
    addBinding(input: {
      workflowName: string;
      stepId: string | null;
      skillName: string;
      provenance?: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/**
 * Outcome of routing a single {@link AssignmentTarget}: `applied` once the
 * skill was bound to its destination, `unrouted` (with a human-readable
 * `reason`) when the destination could not be resolved (e.g. unknown agent
 * profile) — routing failures never throw, so one bad target cannot abort
 * the rest of the batch.
 */
export type AssignmentApplicationOutcome =
  | { status: 'applied'; target: AssignmentTarget }
  | { status: 'unrouted'; target: AssignmentTarget; reason: string };

/**
 * Dependencies {@link import('./skill-assignment.applier').SkillAssignmentApplier}
 * needs to look up and (un)assign an ALREADY-EXISTING skill. A superset of
 * {@link SkillAssignmentDeps.skills}: the standalone `skill_assignment`
 * proposal applies synchronously in `apply()` (no materialization step), so
 * it must confirm the skill exists up front and be able to reverse an
 * `agent_profile` assignment on rollback.
 */
export interface SkillAssignmentApplierSkillsGateway {
  skillExists(name: string): boolean;
  addProfileSkills(profileName: string, skillNames: string[]): Promise<void>;
  addScopedProfileSkill(input: {
    profileName: string;
    skillName: string;
    scopeNodeId: string;
  }): Promise<void>;
  removeProfileSkills(profileName: string, skillNames: string[]): Promise<void>;
}

/**
 * Dependencies {@link import('./skill-assignment.applier').SkillAssignmentApplier}
 * needs to (un)bind a skill to a workflow/step. A superset of
 * {@link SkillAssignmentDeps.bindings} with the reverse `removeBinding`
 * operation for rollback.
 */
export interface SkillAssignmentApplierBindingsGateway {
  addBinding(input: {
    workflowName: string;
    stepId: string | null;
    skillName: string;
    provenance?: Record<string, unknown>;
  }): Promise<unknown>;
  removeBinding(input: {
    workflowName: string;
    stepId: string | null;
    skillName: string;
  }): Promise<void>;
}
