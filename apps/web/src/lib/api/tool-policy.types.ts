/**
 * Tool policy + tool-call approval types — moved out of `./types.ts` so the
 * rest of the web API client can consume a stable surface while the legacy
 * `./types.ts` is incrementally depopulated by child-7.
 *
 * Note: the `ToolPolicyRule` / `ToolPolicyDocument` shapes here intentionally
 * use string-literal unions (matching the legacy web client) rather than
 * the `@nexus/core` `ToolPolicyEffect` enum. The two definitions cover
 * different layers of the system; do not unify them without a coordinated
 * migration.
 */

export interface ToolCallApprovalRequest {
  id: string;
  workflowRunId: string;
  jobId: string;
  projectId: string | null;
  chatSessionId: string | null;
  toolName: string;
  toolArguments: Record<string, unknown>;
  requestedBy: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ToolApprovalRuleScope =
  | "global"
  | "project"
  | "agent_profile"
  | "workflow_run"
  | "chat_session";

export type ToolApprovalRuleEffect = "allow" | "deny" | "require_approval";

export interface ToolApprovalRulePattern {
  path: string;
  operator: "eq" | "contains" | "regex" | "glob";
  value: string;
}

export interface ToolApprovalRule {
  id: string;
  scopeType: ToolApprovalRuleScope;
  scopeId: string | null;
  toolName: string;
  effect: ToolApprovalRuleEffect;
  priority: number;
  argumentPatterns: ToolApprovalRulePattern[] | null;
  createdBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateToolApprovalRuleRequest {
  scopeType: ToolApprovalRuleScope;
  scopeId?: string | null;
  toolName: string;
  effect: ToolApprovalRuleEffect;
  priority?: number;
  argumentPatterns?: ToolApprovalRulePattern[] | null;
  createdBy?: string | null;
  expiresAt?: string | null;
}

export interface UpdateToolApprovalRuleRequest {
  scopeType?: ToolApprovalRuleScope;
  scopeId?: string | null;
  toolName?: string;
  effect?: ToolApprovalRuleEffect;
  priority?: number;
  argumentPatterns?: ToolApprovalRulePattern[] | null;
  expiresAt?: string | null;
}

export interface ToolPolicyRule {
  id?: string;
  effect: "allow" | "deny" | "require_approval" | "guardrail_deny";
  tool: string;
  arguments?: Record<string, unknown>;
  reason?: string;
}

export interface ToolPolicyDocument {
  default: "allow" | "deny" | "require_approval" | "guardrail_deny";
  rules: (ToolPolicyRule | string)[];
}