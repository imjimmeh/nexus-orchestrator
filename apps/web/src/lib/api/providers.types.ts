/**
 * Provider domain types — moved out of `./types.ts` so the rest of the web
 * API client can consume a stable surface while the legacy `./types.ts` is
 * incrementally depopulated by child-7.
 */

import type { ListProvidersQuery } from "@nexus/core";
import type { AuthType, ConfigOwnerType, Timestamps } from "./common.types";

// Re-export the `@nexus/core` provider request shapes under the same names
// the rest of the web client has historically imported from `./types.ts`.
// These keep the existing consumer surface stable.
export type { CreateProviderRequest, UpdateProviderRequest } from "@nexus/core";

export interface LLMProvider extends Timestamps {
  id: string;
  name: string;
  provider_id?: string | null;
  auth_type: AuthType;
  secret_id?: string | null;
  runtime_env: Record<string, unknown>;
  is_active: boolean;
  owner_type?: ConfigOwnerType | null;
  owner_id?: string | null;
  oauth_authorization_url?: string | null;
  oauth_token_url?: string | null;
  oauth_client_id?: string | null;
  oauth_client_secret_id?: string | null;
  oauth_scopes?: string[] | null;
  oauth_redirect_uri?: string | null;
}

export type ListProvidersParams = Partial<ListProvidersQuery>;