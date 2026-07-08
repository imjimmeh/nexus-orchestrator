export interface CreateAuthorizationUrlInput {
  providerId: string;
  redirectUri?: string;
}

export interface AuthorizationUrlResult {
  authorizationUrl: string;
  state: string;
}

export type OAuthStatus =
  | 'not_configured'
  | 'disconnected'
  | 'connected'
  | 'expired';

export interface OAuthStatusResult {
  status: OAuthStatus;
}

export interface CompleteCallbackInput {
  code: string;
  state: string;
}

export interface CompleteCallbackResult {
  status: 'connected';
}
