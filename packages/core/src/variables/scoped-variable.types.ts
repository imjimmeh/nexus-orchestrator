import { z } from "zod";

export type ScopedVariableValueType = "string" | "number" | "boolean" | "json";

export type ScopedVariableSource = "seeded" | "admin";

export interface ResolvedVariable {
  key: string;
  value: unknown;
  type: ScopedVariableValueType;
  /**
   * The scope layer that provided this value. Use the sentinel value 'global'
   * for the NULL-scope (root) layer, or the scope_node_id string otherwise.
   */
  layer: string;
}

export interface UpsertScopedVariableRequest {
  scopeNodeId: string | null;
  key: string;
  value: unknown;
  valueType: ScopedVariableValueType;
  description?: string | null;
}

export const UpsertScopedVariableSchema = z.object({
  scopeNodeId: z.uuid().nullable(),
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/, "invalid variable key format"),
  value: z.unknown(),
  valueType: z.enum(["string", "number", "boolean", "json"]),
  description: z.string().max(2000).nullable().optional(),
});
