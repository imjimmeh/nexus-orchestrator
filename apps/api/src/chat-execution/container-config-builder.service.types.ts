import type { ResolvedRunnerProviderConfig } from '../ai-config/ai-configuration.service';

export interface ContainerBuildInput {
  chatSessionId: string;
  agentProfileName: string;
  initialMessage: string;
  containerTier: number | string;
  agentToken: string;
  toolMountPath: string;
  aiSettings: {
    model: string;
    systemPrompt?: string;
    providerName?: string;
  };
  providerConfig: ResolvedRunnerProviderConfig;
  contextId?: string | null;
}
