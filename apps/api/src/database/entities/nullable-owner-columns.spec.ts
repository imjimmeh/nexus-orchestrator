import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { LlmProvider } from '../../ai-config/database/entities/llm-provider.entity';
import { ProviderOAuthSession } from '../../ai-config/database/entities/provider-oauth-session.entity';
import { SecretStore } from '../../security/database/entities/secret-store.entity';

type EntityConstructor =
  | typeof LlmProvider
  | typeof ProviderOAuthSession
  | typeof SecretStore;
type NullableOwnerColumn = [EntityConstructor, string];

const nullableOwnerColumns: NullableOwnerColumn[] = [
  [LlmProvider, 'owner_id'],
  [LlmProvider, 'oauth_authorization_url'],
  [LlmProvider, 'oauth_token_url'],
  [LlmProvider, 'oauth_client_id'],
  [LlmProvider, 'oauth_redirect_uri'],
  [ProviderOAuthSession, 'owner_id'],
  [SecretStore, 'owner_id'],
];

describe('nullable owner column metadata', () => {
  it.each(nullableOwnerColumns)(
    '%s.%s declares an explicit varchar database type',
    (target, propertyName) => {
      const column = getMetadataArgsStorage().columns.find(
        (candidate) =>
          candidate.target === target &&
          candidate.propertyName === propertyName,
      );

      expect(column?.options.type).toBe('varchar');
    },
  );
});
