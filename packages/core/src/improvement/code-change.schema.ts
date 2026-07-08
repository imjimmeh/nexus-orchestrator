/**
 * Payload schema for the `code_change` improvement proposal kind. This kind
 * already exists on {@link ImprovementProposalKind}
 * (`./improvement-proposal.types`); this module defines the shape of its
 * `payload` column: a structured engineering brief describing a bug or gap
 * the system found in itself, to be turned into a work item in a code repo.
 */
import { z } from "zod";

export const CodeChangeSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const CodeChangeEvidenceSchema = z
  .object({
    runIds: z.array(z.string().min(1)),
    failureClasses: z.array(z.string().min(1)),
    ledgerRefs: z.array(z.string().min(1)),
  })
  .strict();

/**
 * Structured engineering brief carried by a `code_change` improvement
 * proposal: what is wrong, where the evidence lives, and how urgent it is.
 */
export const CodeChangeProposalPayloadSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    suspectedArea: z.array(z.string().min(1)).optional(),
    evidence: CodeChangeEvidenceSchema,
    severity: CodeChangeSeveritySchema,
  })
  .strict();
