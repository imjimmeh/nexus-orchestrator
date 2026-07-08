import type { AssignmentTarget } from "@nexus/core";

/**
 * An {@link AssignmentTarget} that could not be routed to its destination
 * (e.g. an unknown agent profile or workflow), paired with the applier's
 * human-readable reason. Mirrors the shape the API appliers persist under
 * `rollback_data.unrouted_targets` / `provenance.unrouted_targets`.
 */
export interface UnroutedSkillAssignmentTarget {
  target: AssignmentTarget;
  reason: string;
}

/** Pure extraction of a skill-kind proposal's payload + binding provenance. */
export interface SkillProposalDetailData {
  skillName: string | null;
  proposalSummary: string | null;
  patchMarkdown: string | null;
  assignmentTargets: AssignmentTarget[];
  appliedTargets: AssignmentTarget[];
  unroutedTargets: UnroutedSkillAssignmentTarget[];
  hasBindingProvenance: boolean;
}
