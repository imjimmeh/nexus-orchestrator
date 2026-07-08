import type { SchedulerDecision } from "./control-plane.types";
import type { StructuredOrchestrationDecision } from "./structured-decision.types";

export interface ExecutedDecisionIntent {
  readonly structuredDecision: StructuredOrchestrationDecision;
  readonly intentId: string;
  readonly schedulerDecision: SchedulerDecision;
}

export interface ExecuteDirectMutationDecisionInput<TResult> {
  readonly projectId: string;
  readonly requester: string;
  readonly structuredDecision: unknown;
  readonly failureMetadata?: Record<string, unknown>;
  readonly execute: (decision: ExecutedDecisionIntent) => Promise<TResult>;
}
