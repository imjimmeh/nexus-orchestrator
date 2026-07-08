export interface ProviderReferenceInput {
  providerId?: string;
  providerSource?: 'global' | 'user' | 'scope';
  providerName?: string;
  executionContext?: {
    ownerType: 'global' | 'user' | 'scope';
    ownerId?: string | null;
  };
}
