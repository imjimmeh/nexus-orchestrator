export interface HarnessCredentialStatus {
  key: string;
  bound: boolean;
  authType?: 'api_key' | 'oauth_device' | 'oauth_authcode';
}

export interface HarnessValidateResult {
  harnessId: string;
  reachable: boolean;
  capabilities?: Record<string, unknown>;
  credentialStatus: HarnessCredentialStatus[];
}
