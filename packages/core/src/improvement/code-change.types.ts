/**
 * Inferred TypeScript types for the `code_change` improvement proposal
 * payload. Declared in a dedicated `*.types.ts` companion so the project's
 * `no-restricted-syntax` lint policy (exported type aliases live in
 * `*.types.ts` files) is satisfied; the schemas + enum live in
 * `code-change.schema.ts`, the single source of truth.
 */
import type { z } from "zod";
import type {
  CodeChangeEvidenceSchema,
  CodeChangeProposalPayloadSchema,
  CodeChangeSeveritySchema,
} from "./code-change.schema";

export type CodeChangeSeverity = z.infer<typeof CodeChangeSeveritySchema>;
export type CodeChangeEvidence = z.infer<typeof CodeChangeEvidenceSchema>;
export type CodeChangeProposalPayload = z.infer<
  typeof CodeChangeProposalPayloadSchema
>;
