import type {
  ActionRequest,
  DecisionEntry,
  OrchestrationPersistenceRecord,
  PublicDecisionEntry,
} from "./orchestration-internal.types";

type DispatchCapacityDiagnostics = {
  maxActive: number;
  activeCount: number;
  availableSlots: number;
  projectAvailableSlots: number;
  agentCapacityEnabled: boolean;
  configuredAgentCount: number;
  idleAgentCount: number;
  agentAvailableSlots: number;
};

export type DiagnosticsResult = {
  project_id: string;
  blocked: boolean;
  reasons: Array<{ code: string; message: string; remediation?: string }>;
  currentBlockedReason: {
    code: string;
    message: string;
    remediation?: string;
  } | null;
  decisionCount: number;
  decisionHistory: PublicDecisionEntry[];
  pendingActionRequestCount: number;
  lastDecision: DecisionEntry | null;
  dispatch_capacity: DispatchCapacityDiagnostics;
};

export type { ActionRequest, DecisionEntry, OrchestrationPersistenceRecord };
