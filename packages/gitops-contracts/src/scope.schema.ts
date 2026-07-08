import { z } from "zod";
import { GITOPS_API_VERSION, SlugSchema } from "./common.schema";

// Mirrors 204A SCOPE_NODE_TYPES.
export const ScopeNodeTypeSchema = z.enum([
  "platform",
  "org",
  "region",
  "team",
  "project",
]);
export type { ScopeNodeType } from "./scope.schema.types";

/** One `scope.yaml` file. The node's path is derived from its directory chain, not stored here. */
export const ScopeNodeDocSchema = z
  .object({
    apiVersion: z.literal(GITOPS_API_VERSION),
    kind: z.literal("ScopeNode"),
    /** Optional DB id for round-trip fidelity; addressing is by path, not id. */
    id: z.uuid().optional(),
    type: ScopeNodeTypeSchema,
    name: z.string().min(1).max(255),
    slug: SlugSchema,
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .strict();

export type { ScopeNodeDoc } from "./scope.schema.types";
