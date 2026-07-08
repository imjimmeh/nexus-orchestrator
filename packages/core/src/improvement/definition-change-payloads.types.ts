/**
 * Inferred TypeScript types for the `agent_profile_change` and
 * `workflow_definition_change` improvement proposal payloads. Declared in a
 * dedicated `*.types.ts` companion so the project's `no-restricted-syntax`
 * lint policy (exported type aliases live in `*.types.ts` files) is
 * satisfied; the schemas + enum constants live in
 * `definition-change-payloads.schema.ts`, the single source of truth.
 */
import type { z } from "zod";
import type {
  AgentProfileChangePayloadSchema,
  AgentProfilePatchSchema,
  WorkflowChangeSummaryEntrySchema,
  WorkflowDefinitionChangePayloadSchema,
} from "./definition-change-payloads.schema";

export type AgentProfilePatch = z.infer<typeof AgentProfilePatchSchema>;
export type AgentProfileChangePayload = z.infer<
  typeof AgentProfileChangePayloadSchema
>;
export type WorkflowChangeSummaryEntry = z.infer<
  typeof WorkflowChangeSummaryEntrySchema
>;
export type WorkflowDefinitionChangePayload = z.infer<
  typeof WorkflowDefinitionChangePayloadSchema
>;
