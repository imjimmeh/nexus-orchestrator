import type { OrchestrationPolicyKeyDescriptor } from "@nexus/kanban-contracts";

export interface ResolvedPolicyEntry {
  key: string;
  value: string | number | boolean;
  layer: string;
  defaultValue: string | number | boolean;
  descriptor: OrchestrationPolicyKeyDescriptor;
}
