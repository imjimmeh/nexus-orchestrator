/**
 * Tool registry domain types — Tool entity, candidates, validation runs, and
 * request DTOs.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type { ToolRegistrySource } from "@nexus/core";
import type { Timestamps } from "./common.types";

export type ToolPublicationStatus =
  | "draft"
  | "validated"
  | "published"
  | "failed";

export interface Tool extends Timestamps {
  id: string;
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  source: ToolRegistrySource;
  language?: "node" | "python";
  publication_status?: ToolPublicationStatus;
  published_artifact_id?: string | null;
  published_version?: number | null;
}

export interface ToolCandidate extends Timestamps {
  id: string;
  tool_name: string;
  language: "node" | "python";
  source_code: string;
  test_spec?: string | null;
  schema: Record<string, unknown>;
  checksum: string;
  version: number;
  status: ToolPublicationStatus;
  latest_validation_run_id?: string | null;
  is_active: boolean;
  validated_at?: string | null;
  published_at?: string | null;
}

export interface ToolValidationRun extends Timestamps {
  id: string;
  artifact_id: string;
  sandbox_image: string;
  status: "passed" | "failed" | "timeout" | "policy_denied";
  exit_code?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  duration_ms?: number | null;
  policy_denials?: Record<string, unknown> | null;
}

export interface CreateToolRequest {
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  language?: "node" | "python";
  publication_status?: "draft" | "validated" | "published" | "failed";
  published_artifact_id?: string | null;
  published_version?: number | null;
}

export interface UpdateToolRequest {
  name?: string;
  schema?: Record<string, unknown>;
  typescript_code?: string;
  tier_restriction?: number;
  language?: "node" | "python";
  publication_status?: "draft" | "validated" | "published" | "failed";
  published_artifact_id?: string | null;
  published_version?: number | null;
}

export interface CreateToolCandidateRequest {
  tool_name: string;
  language: "node" | "python";
  source_code: string;
  schema: Record<string, unknown>;
  test_spec?: string;
}