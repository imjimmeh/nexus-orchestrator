import { CreateSkillAssignmentProposalOutcome } from "@/lib/api/client.improvement-proposals.types";
import type { AssignSkillOutcomeToast } from "./assign-skill-outcome-toast.helpers.types";

/**
 * Maps the `POST /improvement/proposals` create-route's governance
 * `outcome` (see `SubmitProposalResult['outcome']`,
 * `apps/api/src/improvement/improvement-proposal.service.types.ts`) to a
 * human-readable toast — pulled out as a pure function so the mapping can
 * be tested without mounting the Improvements queue container or the
 * `sonner` toast library.
 */
export function getAssignSkillOutcomeToast(
  outcome: CreateSkillAssignmentProposalOutcome,
): AssignSkillOutcomeToast {
  switch (outcome) {
    case "auto_applied":
      return {
        kind: "success",
        title: "Skill assigned",
        description: "The assignment was applied immediately.",
      };
    case "proposed":
      return {
        kind: "info",
        title: "Proposal created",
        description: "The assignment is pending review in the queue.",
      };
    case "dropped":
      return {
        kind: "warning",
        title: "Proposal dropped",
        description: "Governance dropped this proposal before it was stored.",
      };
    case "apply_failed":
      return {
        kind: "error",
        title: "Assignment failed to apply",
        description: "The proposal was recorded but could not be applied.",
      };
  }
}
