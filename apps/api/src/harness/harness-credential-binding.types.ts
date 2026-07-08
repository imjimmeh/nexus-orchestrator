import type { HarnessAuthType } from '@nexus/core';

export interface UpsertHarnessCredentialBinding {
  id?: string;
  scopeNodeId: string | null;
  harnessId: string;
  credentialKey: string;
  authType: HarnessAuthType;
  secretId: string;
}
