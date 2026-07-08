import type { ApiClient } from "./client";
import type {
  BindCredentialRequest,
  CredentialRequirementsResponse,
  HarnessCredentialBinding,
  OAuthSessionStatus,
  OAuthStartResult,
  ScopedAiDefault,
  SetScopedDefaultRequest,
  StartOAuthRequest,
  SubmitOAuthCodeRequest,
} from "./harness-credentials-api.types";

export function getCredentialRequirements(
  client: ApiClient,
  harnessId: string,
  scopeNodeId?: string,
): Promise<CredentialRequirementsResponse> {
  return client.get<CredentialRequirementsResponse>(
    `/harness/${harnessId}/credentials`,
    { params: scopeNodeId ? { scopeNodeId } : {} },
  );
}

export function bindCredential(
  client: ApiClient,
  harnessId: string,
  key: string,
  body: BindCredentialRequest,
): Promise<HarnessCredentialBinding> {
  return client.put<HarnessCredentialBinding>(
    `/harness/${harnessId}/credentials/${key}`,
    body,
  );
}

export function unbindCredential(
  client: ApiClient,
  harnessId: string,
  key: string,
  scopeNodeId?: string,
): Promise<void> {
  const query = scopeNodeId
    ? `?scopeNodeId=${encodeURIComponent(scopeNodeId)}`
    : "";
  return client.delete(`/harness/${harnessId}/credentials/${key}${query}`);
}

export function startCredentialOAuth(
  client: ApiClient,
  harnessId: string,
  key: string,
  body: StartOAuthRequest,
): Promise<OAuthStartResult> {
  return client.post<OAuthStartResult>(
    `/harness/${harnessId}/credentials/${key}/oauth/start`,
    body,
  );
}

export function submitCredentialOAuthCode(
  client: ApiClient,
  harnessId: string,
  key: string,
  body: SubmitOAuthCodeRequest,
): Promise<{ accepted: boolean }> {
  return client.post<{ accepted: boolean }>(
    `/harness/${harnessId}/credentials/${key}/oauth/submit-code`,
    body,
  );
}

export function getCredentialOAuthStatus(
  client: ApiClient,
  harnessId: string,
  key: string,
  sessionId: string,
): Promise<OAuthSessionStatus> {
  return client.get<OAuthSessionStatus>(
    `/harness/${harnessId}/credentials/${key}/oauth/session/${sessionId}`,
  );
}

export function getScopedDefault(
  client: ApiClient,
  scopeNodeId?: string,
): Promise<ScopedAiDefault> {
  const path = scopeNodeId
    ? `/harness/scoped-defaults/${scopeNodeId}`
    : "/harness/scoped-defaults";
  return client.get<ScopedAiDefault>(path);
}

export function setScopedDefault(
  client: ApiClient,
  scopeNodeId: string,
  body: SetScopedDefaultRequest,
): Promise<ScopedAiDefault> {
  return client.put<ScopedAiDefault>(
    `/harness/scoped-defaults/${scopeNodeId}`,
    body,
  );
}
