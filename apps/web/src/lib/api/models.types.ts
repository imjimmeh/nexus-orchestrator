/**
 * Model domain types — moved out of `./types.ts` so the rest of the web
 * API client can consume a stable surface while the legacy `./types.ts` is
 * incrementally depopulated by child-7.
 */

import type { ListModelsQuery } from "@nexus/core";
import type { Timestamps } from "./common.types";

export interface LLMModel extends Timestamps {
  id: string;
  name: string;
  provider_name?: string | null;
  token_limit: number;
  input_token_cents_per_million?: number | null;
  output_token_cents_per_million?: number | null;
  default_for_execution: boolean;
  default_for_distillation: boolean;
  default_for_summarization: boolean;
  default_for_session: boolean;
  supports_embedding: boolean;
  embedding_dimension?: number | null;
  default_for_embedding: boolean;
  is_active: boolean;
  default_thinking_level?: string | null;
}

export interface CreateModelRequest {
  name: string;
  provider_name?: string;
  token_limit?: number;
  input_token_cents_per_million?: number | null;
  output_token_cents_per_million?: number | null;
  default_for_execution?: boolean;
  default_for_distillation?: boolean;
  default_for_summarization?: boolean;
  default_for_session?: boolean;
  supports_embedding?: boolean;
  embedding_dimension?: number | null;
  default_for_embedding?: boolean;
  is_active?: boolean;
  default_thinking_level?: string | null;
}

export interface UpdateModelRequest {
  name?: string;
  provider_name?: string;
  token_limit?: number;
  input_token_cents_per_million?: number | null;
  output_token_cents_per_million?: number | null;
  default_for_execution?: boolean;
  default_for_distillation?: boolean;
  default_for_summarization?: boolean;
  default_for_session?: boolean;
  supports_embedding?: boolean;
  embedding_dimension?: number | null;
  default_for_embedding?: boolean;
  is_active?: boolean;
  default_thinking_level?: string | null;
}

export type ListModelsParams = Partial<ListModelsQuery>;