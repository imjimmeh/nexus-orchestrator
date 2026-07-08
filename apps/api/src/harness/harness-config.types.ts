import type { HarnessCapabilities } from '@nexus/core';

export interface CreateHarnessInput {
  harnessId: string;
  displayName: string;
  imageRef: string;
  transport: 'kernel' | 'external';
  capabilities: HarnessCapabilities;
  defaultEnv?: Record<string, string>;
  policyScope?: Record<string, unknown>;
}
