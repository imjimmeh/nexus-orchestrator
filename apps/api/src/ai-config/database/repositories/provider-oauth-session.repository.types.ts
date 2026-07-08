export interface CreateProviderOAuthSessionData {
  provider_id: string;
  state_hash: string;
  code_verifier: string;
  redirect_uri: string;
  owner_type?: string;
  owner_id?: string | null;
  expires_at: Date;
}
