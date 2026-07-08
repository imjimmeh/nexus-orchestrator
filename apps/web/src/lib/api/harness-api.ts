import type { ApiClient } from "./client";
import type {
  HarnessDefinition,
  CreateHarnessRequest,
  UpdateHarnessRequest,
  ValidateHarnessResult,
} from "./harness-api.types";

export function listHarnesses(client: ApiClient): Promise<HarnessDefinition[]> {
  return client.get<HarnessDefinition[]>("/harness");
}

export function getHarness(
  client: ApiClient,
  harnessId: string,
): Promise<HarnessDefinition> {
  return client.get<HarnessDefinition>(`/harness/${harnessId}`);
}

export function createHarness(
  client: ApiClient,
  data: CreateHarnessRequest,
): Promise<HarnessDefinition> {
  return client.post<HarnessDefinition>("/harness", data);
}

export function updateHarness(
  client: ApiClient,
  harnessId: string,
  data: UpdateHarnessRequest,
): Promise<HarnessDefinition> {
  return client.patch<HarnessDefinition>(`/harness/${harnessId}`, data);
}

export function deleteHarness(
  client: ApiClient,
  harnessId: string,
): Promise<void> {
  return client.delete(`/harness/${harnessId}`);
}

export function validateHarness(
  client: ApiClient,
  harnessId: string,
): Promise<ValidateHarnessResult> {
  return client.post<ValidateHarnessResult>(`/harness/${harnessId}/validate`);
}
