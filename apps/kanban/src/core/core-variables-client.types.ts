import type {
  ResolvedVariable,
  UpsertScopedVariableRequest,
} from "@nexus/core";

export interface CoreVariablesClient {
  getEffective(scopeId: string): Promise<ResolvedVariable[]>;
  upsert(input: UpsertScopedVariableRequest): Promise<void>;
}

export const CORE_VARIABLES_CLIENT = Symbol("CORE_VARIABLES_CLIENT");
