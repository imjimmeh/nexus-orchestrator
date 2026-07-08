/**
 * Inferred TypeScript types for the retrospective analyst finding contract
 * (EPIC-212 Phase-2). Declared in a dedicated `*.types.ts` companion so the
 * project's `no-restricted-syntax` lint policy (exported type aliases live in
 * `*.types.ts` files) is satisfied; the schema + enum constants live in
 * `retrospective-finding.schema.ts`, the single source of truth.
 */
import type { z } from "zod";
import type {
  RETROSPECTIVE_FINDING_KINDS,
  RETROSPECTIVE_SCOPE_HINTS,
  retrospectiveFindingSchema,
} from "./retrospective-finding.schema";

/** The validated finding shape (inferred from the schema, single source). */
export type RetrospectiveFinding = z.infer<typeof retrospectiveFindingSchema>;

/** A finding `kind` value. */
export type RetrospectiveFindingKind =
  (typeof RETROSPECTIVE_FINDING_KINDS)[number];

/** A finding `scope_hint` value. */
export type RetrospectiveScopeHint = (typeof RETROSPECTIVE_SCOPE_HINTS)[number];
