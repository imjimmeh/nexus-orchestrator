import type { JsonValue } from "../schemas/common/json-value.schema";

export type RunnerThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface RunnerApiKeyAuth {
  type: "api_key";
  /** Provider API key; delivered through runner config and must not be logged. */
  apiKey: string;
}

export interface RunnerOAuthCredential {
  type: "oauth";
  /** OAuth refresh token; delivered through runner config and must not be logged. */
  refreshToken: string;
  /** Current OAuth access token; delivered through runner config and must not be logged. */
  accessToken: string;
  /** Access-token expiration timestamp in milliseconds since epoch. */
  expiresAt: number;
}

export interface RunnerOAuthAuth {
  type: "oauth";
  credential: RunnerOAuthCredential;
}

export type RunnerProviderAuth = RunnerApiKeyAuth | RunnerOAuthAuth;

export interface RunnerOAuthRefreshConfig {
  /** Token endpoint used to refresh the OAuth credential inside pi-runner. */
  tokenUrl: string;
  /** HTTP method for the token endpoint. Defaults to POST. */
  method?: "POST";
  /** Static headers for the refresh request. */
  headers?: Record<string, string>;
  /** Static JSON body fields merged with the refresh-token parameter. */
  body?: Record<string, JsonValue>;
  /** Request body field that receives the current refresh token. Defaults to refresh_token. */
  refreshTokenParam?: string;
  /** Dot path to the access token in the token endpoint response. Defaults to access_token. */
  accessTokenPath?: string;
  /** Dot path to the replacement refresh token in the response. Defaults to refresh_token. */
  refreshTokenPath?: string;
  /** Dot path to expires-in seconds in the response. Defaults to expires_in. */
  expiresInPath?: string;
  /** Dot path to an absolute expiration timestamp in milliseconds. */
  expiresAtPath?: string;
}

export interface RunnerOAuthProviderConfig {
  /** Display name used by upstream pi OAuth provider metadata. */
  name: string;
  /** Declarative refresh contract used by pi-runner to synthesize refreshToken(). */
  refresh: RunnerOAuthRefreshConfig;
}

export interface RunnerProviderModelConfig {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Record<string, JsonValue>;
}

export interface RunnerProviderRegistrationConfig {
  name?: string;
  baseUrl?: string;
  api?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  oauth?: RunnerOAuthProviderConfig;
  models?: RunnerProviderModelConfig[];
}
