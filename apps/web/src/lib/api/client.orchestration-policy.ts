import { api } from "./client";
import type {
  OrchestrationMode,
  ResolvedPolicyEntryDto,
} from "./client.orchestration-policy.types";

export type {
  OrchestrationMode,
  PolicyDescriptorDto,
  ResolvedPolicyEntryDto,
} from "./client.orchestration-policy.types";

export async function getOrchestrationPolicy(
  projectId: string,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.get<ResolvedPolicyEntryDto[]>(
    `/orchestration/${projectId}/policy`,
  );
  return res;
}

export async function updateOrchestrationPolicy(
  projectId: string,
  entries: Array<{ key: string; value: unknown }>,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.put<ResolvedPolicyEntryDto[]>(
    `/orchestration/${projectId}/policy`,
    { entries },
  );
  return res;
}

export async function applyOrchestrationPreset(
  projectId: string,
  mode: OrchestrationMode,
): Promise<ResolvedPolicyEntryDto[]> {
  const res = await api.put<ResolvedPolicyEntryDto[]>(
    `/orchestration/${projectId}/policy/preset`,
    { mode },
  );
  return res;
}
