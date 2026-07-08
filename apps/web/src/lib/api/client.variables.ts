import { api } from "./client";
import type {
  ScopedVariableRow,
  ResolvedVariableDto,
  UpsertVariableBody,
} from "./client.variables.types";

export type {
  ScopedVariableRow,
  ResolvedVariableDto,
  UpsertVariableBody,
} from "./client.variables.types";

const scopeParam = (scopeId?: string | null) =>
  scopeId ? { params: { scopeId } } : undefined;

export async function listVariables(
  scopeId?: string | null,
): Promise<ScopedVariableRow[]> {
  const res = await api.get<ScopedVariableRow[]>(
    "/variables",
    scopeParam(scopeId),
  );
  return res;
}

export async function getEffectiveVariables(
  scopeId?: string | null,
): Promise<ResolvedVariableDto[]> {
  const res = await api.get<ResolvedVariableDto[]>(
    "/variables/effective",
    scopeParam(scopeId),
  );
  return res;
}

export async function upsertVariable(body: UpsertVariableBody): Promise<void> {
  await api.post<void>("/variables", body);
}

export async function deleteVariable(
  key: string,
  scopeId?: string | null,
): Promise<void> {
  const query = new URLSearchParams({ key });
  if (scopeId) query.set("scopeId", scopeId);
  await api.delete(`/variables?${query.toString()}`);
}
