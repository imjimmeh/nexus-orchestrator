import { Injectable } from '@nestjs/common';
import type { OAuthProviderInterface } from '@earendil-works/pi-ai/oauth';
import type { OAuthProviderResolver } from './oauth-login.types';
import {
  createAnthropicOAuthProvider,
  ANTHROPIC_OAUTH_PROVIDER_ID,
} from './anthropic-oauth.provider';
import { LlmProviderRepository } from '../ai-config/database/repositories/llm-provider.repository';

type GetOAuthProvider = (id: string) => OAuthProviderInterface | undefined;

/**
 * Resolves pi-ai OAuth presets via the SDK registry. The SDK is imported
 * dynamically (ESM-only) and cached after first use.
 *
 * The `anthropic` preset is served by a local server-less implementation
 * ({@link createAnthropicOAuthProvider}) instead of the SDK's, which binds and
 * leaks a loopback callback server on 127.0.0.1:53692.
 */
@Injectable()
export class PiAiOAuthProviderResolver implements OAuthProviderResolver {
  private getOAuthProvider?: GetOAuthProvider;

  constructor(private readonly llmProviderRepository: LlmProviderRepository) {}

  async resolve(
    piProviderId: string,
  ): Promise<OAuthProviderInterface | undefined> {
    if (piProviderId === ANTHROPIC_OAUTH_PROVIDER_ID) {
      const row =
        await this.llmProviderRepository.findByProviderId(piProviderId);
      if (
        !row ||
        !row.oauth_client_id ||
        !row.oauth_authorization_url ||
        !row.oauth_token_url ||
        !row.oauth_redirect_uri ||
        !row.oauth_scopes
      ) {
        throw new Error(
          'Anthropic LlmProvider row not found or OAuth columns are not configured',
        );
      }
      return createAnthropicOAuthProvider({
        clientId: row.oauth_client_id,
        authorizeUrl: row.oauth_authorization_url,
        tokenUrl: row.oauth_token_url,
        redirectUri: row.oauth_redirect_uri,
        scopes: (row.oauth_scopes ?? []).join(' '),
      });
    }
    if (!this.getOAuthProvider) {
      const mod = await import('@earendil-works/pi-ai/oauth');
      this.getOAuthProvider = mod.getOAuthProvider;
    }
    return this.getOAuthProvider(piProviderId);
  }
}
