import type { ProjectOrchestration } from "@nexus/kanban-contracts";
import type {
  OrchestrationMode,
  OrchestrationStatus,
  StartOrchestrationInput,
} from "./orchestration.types";

export type DecisionEntry = {
  timestamp: string;
  type: string;
  reasoning?: string;
  actions?: string[];
  reason?: string;
  previousDecision?: string;
  requestedAction?: string;
  modeEvaluation?: "allow" | "deny" | "require_approval";
  executionStatus?: "executed" | "queued_for_approval" | "denied" | "failed";
  correlationId?: string;
  recommendation?: string;
  cycleDecision?: "repeat" | "pause" | "complete" | "blocked";
  idempotencyKey?: string;
  autonomousDefault?: boolean;
  readyWorkRemaining?: boolean;
};

export type CycleDecision = NonNullable<DecisionEntry["cycleDecision"]>;
export type StopCycleDecision = Exclude<CycleDecision, "repeat">;
export type PublicDecisionEntry = NonNullable<
  ProjectOrchestration["decisionLog"]
>[number];

export type ActionRequest = {
  id: string;
  project_id: string;
  action: string;
  payload: Record<string, unknown> | null;
  workflowRunId: string | null;
  modeAtRequest: "autonomous" | "supervised" | "notifications_only";
  requestedBy: string | null;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  executedAt: string | null;
  errorMessage: string | null;
  correlationId: string;
  created_at: string;
  updated_at: string;
};

export type ActionRequestStatusFilter = "pending" | "fulfilled" | "all";

export type ActivityEntry =
  | { kind: "decision"; timestamp: string; summary: string; status?: string }
  | {
      kind: "action_request";
      timestamp: string;
      summary: string;
      status: string;
    };

export type ActionRequestListItem = ActionRequest & {
  projectName: string | null;
  workflowId: string | null;
};

export type ResolvedStartupContext = Pick<
  StartOrchestrationInput,
  "sourceContext" | "readinessContext" | "startupHints"
>;

export type OrchestrationPersistenceRecord = {
  project_id: string;
  goals: string;
  mode: string;
  status: string;
  linked_run_id: string | null;
  decision_log?: DecisionEntry[] | null;
  action_requests?: ActionRequest[] | null;
  metadata?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export type WakeupCooldownState = {
  lastWakeupAt?: string;
  source?: string;
  reason?: string;
  lastStaleWakeupAt?: string;
  lastStaleSource?: string;
  lastStaleReason?: string;
};

export function toOrchestrationMode(value: string): OrchestrationMode {
  return value as OrchestrationMode;
}

export function toOrchestrationStatus(value: string): OrchestrationStatus {
  return value as OrchestrationStatus;
}
