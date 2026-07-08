export type HarnessAuthType = "api_key" | "oauth_device" | "oauth_authcode";

export interface CredentialRequirementStatus {
  key: string;
  displayName: string;
  authTypes: HarnessAuthType[];
  primary?: boolean;
  optional?: boolean;
  bound: boolean;
  boundAuthType?: HarnessAuthType;
  boundSecretId?: string;
  boundScopeNodeId?: string | null;
}

export interface CredentialRequirementsResponse {
  harnessId: string;
  scopeNodeId?: string | null;
  requirements: CredentialRequirementStatus[];
}

export interface BindCredentialRequest {
  authType: HarnessAuthType;
  secretId: string;
  scopeNodeId?: string;
}

export interface HarnessCredentialBinding {
  id: string;
  scopeNodeId: string | null;
  harnessId: string;
  credentialKey: string;
  authType: HarnessAuthType;
  secretId: string;
}

// OAuth login contract is shared from @nexus/core (single source of truth).
export type {
  OAuthModality,
  OAuthSessionStatusValue,
  OAuthStartResult,
  OAuthSessionStatus,
  StartHarnessOAuthRequest as StartOAuthRequest,
  SubmitOAuthCodeRequest,
} from "@nexus/core";

export interface ScopedAiDefault {
  scopeNodeId: string | null;
  harnessId?: string | null;
  modelName?: string | null;
  providerName?: string | null;
}

export interface SetScopedDefaultRequest {
  harnessId?: string;
  modelName?: string;
  providerName?: string;
}
