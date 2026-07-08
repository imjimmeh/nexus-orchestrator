/**
 * Inferred TypeScript type for the shared assignment-target request schema.
 * Declared in a dedicated `*.types.ts` companion so the project's
 * `no-restricted-syntax` lint policy (exported type aliases live in
 * `*.types.ts` files) is satisfied; the schema lives in
 * `assignment-target.schema.ts`, the single source of truth.
 */
import type { z } from "zod";
import type { assignmentTargetSchema } from "./assignment-target.schema";

export type AssignmentTargetInput = z.infer<typeof assignmentTargetSchema>;
