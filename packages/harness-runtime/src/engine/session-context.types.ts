// packages/harness-runtime/src/engine/session-context.types.ts
import type { HarnessContributions } from "@nexus/core";

/** Generic tool call result returned by kernel-level callbacks. */
export interface ToolCallResult<T = unknown> {
  content: unknown[];
  details?: T;
  terminate?: boolean;
}

export type PermissionDecision =
  | { status: "allowed" }
  | { status: "denied"; reason?: string; code?: string }
  | { status: "approval_required"; reason?: string };

/** A governance-wrapped tool ready for execute_wrapped engines. */
export interface CanonicalToolDefinition {
  name: string;
  description: string;
  parameters: unknown; // JSON schema
  execute: (
    callId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

/** A raw tool spec for permission_callback engines (governance applied by the engine). */
export interface CanonicalToolSpec {
  name: string;
  description: string;
  parameters: unknown;
  invoke: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface CommandExecRequest {
  command: string;
  timeoutMs?: number;
  workingDir?: string;
}

export interface CommandExecResult {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface HarnessSessionContext {
  governedTools: CanonicalToolDefinition[];
  toolCatalog: CanonicalToolSpec[];
  checkPermission(
    toolName: string,
    params: unknown,
  ): Promise<PermissionDecision>;
  workspacePath: string;
  agentDir: string;
  extensionsPath: string;
  sessionPath: string;
  /** Resolved author contributions for this session (empty when none). */
  contributions: HarnessContributions;
}
