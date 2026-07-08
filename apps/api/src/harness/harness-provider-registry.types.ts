import type { HarnessId, HarnessCapabilities } from '@nexus/core';

export type HarnessTransport = 'kernel' | 'external';

export interface HarnessProviderEntry {
  harnessId: HarnessId;
  displayName: string;
  capabilities: HarnessCapabilities;
  imageRef: string;
  defaultEnv: Record<string, string>;
  transport: HarnessTransport;
  source: 'builtin' | 'custom';
  enabled: boolean;
}

export type SelectionScope = { scopeNodeId?: string; agentProfile?: string };
