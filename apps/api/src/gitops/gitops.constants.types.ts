import { RECONCILE_OBJECT_TYPES } from './gitops.constants';

export type ReconcileObjectType = (typeof RECONCILE_OBJECT_TYPES)[number];

export interface GitOpsConfig {
  enabled: boolean;
  repoUrl: string;
  ref: string;
  intervalMs: number;
}
