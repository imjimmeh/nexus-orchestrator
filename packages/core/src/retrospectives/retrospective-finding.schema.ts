/**
 * Shared contract for a single retrospective analyst finding (EPIC-212
 * Phase-2). The light-tier analyst run (`run_retrospective`) emits a
 * `findings[]` array via `set_job_output`; each entry MUST match the flat
 * shape declared here. The analysis orchestrator (API side) validates every
 * raw finding against {@link retrospectiveFindingSchema} and drops anything
 * that does not parse, so a malformed or hallucinated entry can never reach
 * the deterministic router.
 *
 * Lives in `@nexus/core` (the scope/context-neutral shared package) so the
 * API analysis/router services and any downstream consumer reference the same
 * surface. The shape is FLAT and provider-safe: no nested objects, no unions
 * beyond simple string enums, so it round-trips cleanly through strict
 * tool-schema providers and through `JSON.stringify` into the workflow
 * trigger.
 *
 * Field semantics mirror the analyst prompt verbatim:
 *   - `kind`            — the finding class; `none` means "no durable lesson".
 *   - `lesson`          — the one-sentence generalizable takeaway.
 *   - `root_cause`      — why it happened (the analyst is told to set this for
 *                         `memory` findings; optional at the contract layer).
 *   - `fix`             — the concrete corrective action (likewise).
 *   - `working_procedure` — the reusable step-by-step (for `skill_proposal`).
 *   - `scope_hint`      — the analyst's NON-binding scope suggestion; the
 *                         deterministic router decides the real destination.
 *   - `confidence_self` — the analyst's self-reported confidence. The router
 *                         RE-DERIVES confidence and ignores this value, so the
 *                         contract is intentionally lenient (any number) — a
 *                         hallucinated confidence must not drop an otherwise
 *                         evidence-backed finding.
 *   - `evidence_event_ids` — `event_ledger` row ids the finding cites; the
 *                         orchestrator verifies these against the original
 *                         run and drops fabricated ids.
 *   - `assignment_targets` — OPTIONAL, `skill_proposal`-only: the analyst's
 *                         non-binding suggestion of agent profiles / workflow
 *                         steps the resulting skill should be bound to (same
 *                         shape as the `suggest_skill_assignment` tool's
 *                         `targets` input). Left untyped here (`unknown[]`)
 *                         so a malformed entry never fails the WHOLE finding
 *                         at this layer — the router's own
 *                         `parseAssignmentTargets` (Epic B1) does the real
 *                         structural validation downstream, silently
 *                         dropping malformed entries one at a time.
 *   - `profile_change`  — REQUIRED when `kind === 'agent_profile_change'`:
 *                         the proposed `agent_profiles` patch (EPIC-D
 *                         `AgentProfileChangePayloadSchema`).
 *   - `workflow_change` — REQUIRED when `kind === 'workflow_definition_change'`:
 *                         the proposed workflow YAML change (EPIC-D
 *                         `WorkflowDefinitionChangePayloadSchema`).
 */
import { z } from "zod";
import {
  AgentProfileChangePayloadSchema,
  WorkflowDefinitionChangePayloadSchema,
} from "../improvement/definition-change-payloads.schema";

/** The five finding classes the analyst may emit. */
export const RETROSPECTIVE_FINDING_KINDS = [
  "memory",
  "skill_proposal",
  "agent_profile_change",
  "workflow_definition_change",
  "none",
] as const;

/** The non-binding scope suggestions the analyst may attach to a finding. */
export const RETROSPECTIVE_SCOPE_HINTS = [
  "project",
  "global",
  "agent_preference",
  "workflow_specific",
] as const;

/**
 * Zod schema for one analyst finding. Unknown keys are stripped (Zod's
 * default object behaviour) so the analyst may emit extra fields without
 * breaking validation. `lesson` and every cited `evidence_event_id` must be
 * non-empty; `kind` and `scope_hint` are constrained to their enums.
 */
export const retrospectiveFindingSchema = z
  .object({
    kind: z.enum(RETROSPECTIVE_FINDING_KINDS),
    lesson: z.string().trim().min(1),
    root_cause: z.string().trim().min(1).optional(),
    fix: z.string().trim().min(1).optional(),
    working_procedure: z.string().trim().min(1).optional(),
    scope_hint: z.enum(RETROSPECTIVE_SCOPE_HINTS).optional(),
    confidence_self: z.number(),
    evidence_event_ids: z.array(z.string().trim().min(1)),
    assignment_targets: z.array(z.unknown()).optional(),
    profile_change: AgentProfileChangePayloadSchema.optional(),
    workflow_change: WorkflowDefinitionChangePayloadSchema.optional(),
  })
  .superRefine((finding, ctx) => {
    if (finding.kind === "agent_profile_change" && !finding.profile_change) {
      ctx.addIssue({
        code: "custom",
        message: "profile_change is required when kind is agent_profile_change",
        path: ["profile_change"],
      });
    }
    if (
      finding.kind === "workflow_definition_change" &&
      !finding.workflow_change
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "workflow_change is required when kind is workflow_definition_change",
        path: ["workflow_change"],
      });
    }
  });
