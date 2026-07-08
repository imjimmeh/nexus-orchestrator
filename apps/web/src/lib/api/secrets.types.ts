/**
 * Secret domain types — moved out of `./types.ts` so the rest of the web
 * API client can consume a stable surface while the legacy `./types.ts` is
 * incrementally depopulated by child-7.
 */

import type { Timestamps } from "./common.types";

export interface Secret extends Timestamps {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface CreateSecretRequest {
  name: string;
  value: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateSecretRequest {
  name?: string;
  value?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ListSecretsParams {
  /** Confines the listing to secrets owned by this scope node. */
  scopeNodeId?: string;
}