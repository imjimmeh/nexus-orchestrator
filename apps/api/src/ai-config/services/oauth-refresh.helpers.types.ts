/** Tokens parsed from a successful refresh-token grant response. */
export interface RefreshedOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}

/** Inputs for a token-endpoint refresh-token grant POST. */
export interface TokenEndpointRefreshParams {
  tokenUrl: string;
  clientId: string;
  clientSecret: string | null;
  previousRefreshToken: string;
  providerName: string;
}
