import { z } from "zod";

/**
 * Shared assignment-target request shape — the structural (unvalidated)
 * form both the `suggest_skill_assignment` agent tool and the browser-facing
 * `POST /improvement/proposals` create-route accept for a `skill_assignment`
 * target. Kept here so both producers validate identically (DRY) instead of
 * each declaring their own copy.
 *
 * Deliberately loose (no discriminated-union refinement tying `profileName`/
 * `workflowName` to `type`): semantic coercion into a concrete
 * {@link AssignmentTarget} — including dropping malformed entries — is the
 * job of `parseAssignmentTargets` (`apps/api/src/improvement/appliers/assignment-target.helpers.ts`),
 * which every producer already routes through before a proposal is filed.
 */
export const assignmentTargetSchema = z.object({
  type: z.enum(["agent_profile", "workflow_step"]),
  profileName: z.string().optional(),
  workflowName: z.string().optional(),
  stepId: z.string().optional(),
});
