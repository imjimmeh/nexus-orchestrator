import type {
  ToolCandidateLanguage,
  ToolValidationRunStatus,
} from '@nexus/core';

export interface ToolSandboxCandidateInput {
  language: ToolCandidateLanguage;
  source_code: string;
  params?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface ToolSandboxRunResult {
  status: ToolValidationRunStatus;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  sandbox_image: string;
  policy_denials?: Record<string, unknown> | null;
  output?: unknown;
}
