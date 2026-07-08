import { ContainerTier, ToolPolicyDocument } from '@nexus/core';

export interface IAgentProfile {
  name: string;
  tier: ContainerTier;
  toolPolicy?: ToolPolicyDocument;
}
