import type { HarnessId } from '@nexus/core';

export interface HarnessOAuthStartParams {
  harnessId: HarnessId;
  credentialKey: string;
  scopeNodeId: string | null;
}
