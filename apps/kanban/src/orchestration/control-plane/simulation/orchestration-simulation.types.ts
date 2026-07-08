import type { LaunchAttemptStatus } from "../control-plane.types";

export type OrchestrationSimulationAction =
  | "publish_fact"
  | "create_intent"
  | "evaluate_intent"
  | "record_launch_attempt"
  | "publish_event_projection"
  | "repair_stale_link";

export interface OrchestrationSimulationStep {
  readonly name: string;
  readonly action: OrchestrationSimulationAction;
  readonly input: Record<string, unknown>;
}

export interface OrchestrationSimulationExpected {
  readonly intents?: Array<{ readonly type: string; readonly status: string }>;
  readonly facts?: Array<{
    readonly type: string;
    readonly freshnessStatus?: string;
  }>;
  readonly noLaunchReasons?: string[];
  readonly launchedWorkflows?: string[];
}

export interface OrchestrationSimulationScenario {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly steps: OrchestrationSimulationStep[];
  readonly expected: OrchestrationSimulationExpected;
}

export interface OrchestrationSimulationResult {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly diagnostics: string[];
}

export interface SimulationIntentRecord {
  readonly type: string;
  readonly status: string;
}

export interface SimulationFactRecord {
  readonly type: string;
  readonly freshnessStatus: string;
}

export interface SimulationLaunchAttemptRecord {
  readonly workflowId: string;
  readonly status: string;
}

export interface SimulationRecordLaunchAttemptInput {
  readonly intentId: string;
  readonly outcomeId?: string | null;
  readonly workflowId: string;
  readonly workflowScope?: string | null;
  readonly workflowRunId?: string | null;
  readonly idempotencyKey: string;
  readonly status: LaunchAttemptStatus;
  readonly requestedAt?: Date;
  readonly completedAt?: Date | null;
  readonly failureReason?: string | null;
  readonly responsePayload?: Record<string, unknown> | null;
  readonly metadata?: Record<string, unknown> | null;
}
