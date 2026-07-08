import type { IntegrationStrategy, MergeMethod } from './merge-provider.types';

export interface ResolvedIntegrationConfig {
  strategy: IntegrationStrategy; // default 'direct-push'
  mergeMethod: MergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}
