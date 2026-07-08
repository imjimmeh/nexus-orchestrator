export interface ScopedVariableRow {
  id: string;
  scope_node_id: string | null;
  key: string;
  value: unknown;
  value_type: "string" | "number" | "boolean" | "json";
  description: string | null;
}

export interface ResolvedVariableDto {
  key: string;
  value: unknown;
  type: string;
  layer: string;
}

export interface UpsertVariableBody {
  scopeNodeId: string | null;
  key: string;
  value: unknown;
  valueType: "string" | "number" | "boolean" | "json";
  description?: string | null;
}
