/**
 * Configuration values required to construct an Anthropic OAuth provider.
 *
 * These values are expected to come from the `llm_providers` DB row for the
 * `anthropic` provider so that client IDs, endpoints, scopes, and redirect URIs
 * can be changed without code edits.
 */
export interface AnthropicOAuthConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string;
}
