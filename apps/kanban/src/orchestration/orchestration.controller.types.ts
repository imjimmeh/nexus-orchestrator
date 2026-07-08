/**
 * Co-located request-body type aliases for {@link OrchestrationController}
 * and {@link OrchestrationActionRequestsController}.
 *
 * These types describe the wire shape accepted by the orchestration HTTP
 * surface. They are intentionally kept free of framework decorators
 * (Zod/class-validator) so the controller remains the only transport
 * boundary: validators, when introduced, can live alongside these types
 * without disturbing the service layer.
 *
 * Keeping the types in their own module also lets the controllers slim
 * down to routing + delegation while preserving a stable, importable
 * surface for integration tests and e2e suites that construct these
 * payloads directly.
 */
import type { OrchestrationPolicyMode } from "@nexus/kanban-contracts";
import type {
  OrchestrationMode,
  StartupRoutingHints,
  StartupRoutingReadinessContext,
  StartupRoutingSourceContext,
} from "./orchestration.types";

export type StartOrchestrationBody = {
  goals?: string;
  workflow_id?: string;
  requested_by?: string;
  orchestration_mode?: OrchestrationMode;
  source_context?: StartupRoutingSourceContext;
  readiness_context?: StartupRoutingReadinessContext;
  startup_hints?: StartupRoutingHints;
};

export type UpdateOrchestrationModeBody = {
  orchestration_mode?: OrchestrationPolicyMode;
};

export type RecordDecisionBody = {
  type?: string;
  reasoning?: string;
  actions?: string[];
  requested_action?: string;
  mode_evaluation?: "allow" | "deny" | "require_approval";
  execution_status?: "executed" | "queued_for_approval" | "denied" | "failed";
  recommendation?: string;
};

export type RequestActionBody = {
  action?: string;
  payload?: Record<string, unknown> | null;
  requested_by?: string;
  workflow_run_id?: string | null;
};

export type ApproveActionBody = {
  approved_by?: string;
};

export type RejectActionBody = {
  rejected_by?: string;
  reason?: string;
};

export type ActionRequestStatusFilter = "pending" | "fulfilled" | "all";

export type TriggerCycleBody = {
  reason?: string;
};