export interface HarnessDefinition {
  id: string;
  harnessId: string;
  displayName: string;
  source: "builtin" | "custom";
  capabilities: Record<string, unknown>;
  imageRef: string;
  transport: string;
  enabled: boolean;
  secretRefs: Record<string, unknown>;
  defaultEnv: Record<string, string>;
  policyScope: Record<string, unknown>;
  compatibleProviderIds?: string[];
  defaultProviderId?: string;
}

export interface CreateHarnessRequest {
  harnessId: string;
  displayName: string;
  imageRef: string;
  transport: string;
  capabilities?: Record<string, unknown>;
  secretRefs?: Record<string, unknown>;
  defaultEnv?: Record<string, string>;
  policyScope?: Record<string, unknown>;
}

export interface UpdateHarnessRequest {
  displayName?: string;
  imageRef?: string;
  transport?: string;
  capabilities?: Record<string, unknown>;
  secretRefs?: Record<string, unknown>;
  defaultEnv?: Record<string, string>;
  policyScope?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ValidateHarnessResult {
  ok: boolean;
  message?: string;
}
