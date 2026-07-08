import type { RepairPolicyClass } from './failure-classification.types';
import type { RepairDelegationExecutionPath } from './repair-delegation.types';

export interface RepairPolicyMetadata {
  minimumConfidence: number;
  allowedRepairActionIds: string[];
  humanRequired: boolean;
  defaultExecutor?: RepairDelegationExecutionPath;
  diagnosticLabel: string;
}

export type RepairPolicyConfig = Record<
  RepairPolicyClass,
  RepairPolicyMetadata
>;
