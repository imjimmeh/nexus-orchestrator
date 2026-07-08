import type { AssignmentTarget } from "@nexus/core";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import type {
  SkillProposalDetailData,
  UnroutedSkillAssignmentTarget,
} from "./skill-proposal-detail.types";

/**
 * Coerces a raw `payload.assignment_targets` (or `rollback_data.applied_targets`)
 * value into a typed, best-effort array of {@link AssignmentTarget}s. Malformed
 * entries are silently dropped rather than thrown — this is a read-only detail
 * view, not a validator, and the API layer already validates on write.
 */
export function parseAssignmentTargets(raw: unknown): AssignmentTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => coerceAssignmentTarget(entry))
    .filter((target): target is AssignmentTarget => target !== null);
}

/**
 * Coerces a raw `rollback_data.unrouted_targets` value into a typed array of
 * {@link UnroutedSkillAssignmentTarget}s, dropping malformed entries.
 */
export function parseUnroutedTargets(
  raw: unknown,
): UnroutedSkillAssignmentTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: UnroutedSkillAssignmentTarget[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const target = coerceAssignmentTarget(candidate.target);
    if (!target || typeof candidate.reason !== "string") continue;
    out.push({ target, reason: candidate.reason });
  }
  return out;
}

/** Human-readable label for a single {@link AssignmentTarget}. */
export function describeAssignmentTarget(target: AssignmentTarget): string {
  if (target.type === "agent_profile") {
    return `Agent profile: ${target.profileName}`;
  }
  return target.stepId
    ? `Workflow step: ${target.workflowName} / ${target.stepId}`
    : `Workflow: ${target.workflowName}`;
}

/**
 * Extracts a {@link SkillProposalDetailData} view model from a `skill_create`
 * or `skill_assignment` proposal. Binding provenance (`appliedTargets` /
 * `unroutedTargets`) is read from `rollback_data` first — the shape the
 * appliers actually persist it under — falling back to `provenance` so a
 * future materialization change that records it there still renders.
 */
export function getSkillProposalDetailData(
  proposal: ImprovementProposal,
): SkillProposalDetailData {
  const payload = proposal.payload as Record<string, unknown>;
  const rollbackData = proposal.rollback_data ?? {};
  const provenance = proposal.provenance ?? {};

  const appliedRaw = rollbackData.applied_targets ?? provenance.applied_targets;
  const unroutedRaw =
    rollbackData.unrouted_targets ?? provenance.unrouted_targets;

  return {
    skillName: readNonEmptyString(
      payload.target_skill_name ?? payload.skillName,
    ),
    proposalSummary: readNonEmptyString(payload.proposal_summary),
    patchMarkdown: readNonEmptyString(payload.patch_markdown),
    assignmentTargets: parseAssignmentTargets(payload.assignment_targets),
    appliedTargets: parseAssignmentTargets(appliedRaw),
    unroutedTargets: parseUnroutedTargets(unroutedRaw),
    hasBindingProvenance: appliedRaw !== undefined || unroutedRaw !== undefined,
  };
}

function coerceAssignmentTarget(entry: unknown): AssignmentTarget | null {
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Record<string, unknown>;
  if (
    candidate.type === "agent_profile" &&
    typeof candidate.profileName === "string" &&
    candidate.profileName
  ) {
    return { type: "agent_profile", profileName: candidate.profileName };
  }
  if (
    candidate.type === "workflow_step" &&
    typeof candidate.workflowName === "string" &&
    candidate.workflowName
  ) {
    return {
      type: "workflow_step",
      workflowName: candidate.workflowName,
      ...(typeof candidate.stepId === "string" && candidate.stepId
        ? { stepId: candidate.stepId }
        : {}),
    };
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
