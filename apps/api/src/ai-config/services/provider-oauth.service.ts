import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { ProviderOAuthSessionRepository } from '../database/repositories/provider-oauth-session.repository';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import type { LlmProvider } from '../database/entities/llm-provider.entity';
import {
  OAUTH_PROVIDER_RESOLVER,
  type OAuthProviderResolver,
} from '../../oauth/oauth-login.types';
import type { OAuthProviderInterface } from '@earendil-works/pi-ai/oauth';
import type {
  CreateAuthorizationUrlInput,
  AuthorizationUrlResult,
  OAuthStatusResult,
  CompleteCallbackInput,
  CompleteCallbackResult,
} from './provider-oauth.service.types';
import {
  isOAuthTokenExpiring,
  postRefreshTokenGrant,
  buildPiRefreshCredentials,
  mapPiCredentialsToRefreshedTokens,
  parseClientSecretPayload,
  type RefreshedOAuthTokens,
} from './oauth-refresh.helpers';
import { validateAuthorizationCodeTokenResponse } from './oauth-token-response.helpers';

const SESSION_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class ProviderOAuthService {
  /** Per-provider single-flight so concurrent launches refresh a rotating token only once. */
  private readonly inflightRefresh = new Map<string, Promise<void>>();

  constructor(
    private readonly providerRepo: LlmProviderRepository,
    private readonly sessionRepo: ProviderOAuthSessionRepository,
    private readonly secretCrud: SecretCrudService,
    @Inject(OAUTH_PROVIDER_RESOLVER)
    private readonly oauthProviderResolver: OAuthProviderResolver,
  ) {}

  async createAuthorizationUrl(
    input: CreateAuthorizationUrlInput,
  ): Promise<AuthorizationUrlResult> {
    const { provider, redirectUri } =
      await this.resolveOAuthProviderAndRedirect(input);

    const state = randomUrlSafe(32);
    const codeVerifier = randomUrlSafe(32);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const stateHash = sha256Base64Url(state);

    const clientId = provider.oauth_client_id as string;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (provider.oauth_scopes && provider.oauth_scopes.length > 0) {
      params.set('scope', provider.oauth_scopes.join(' '));
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionRepo.create({
      provider_id: provider.id,
      state_hash: stateHash,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      owner_type: provider.owner_type,
      owner_id: provider.owner_id ?? null,
      expires_at: expiresAt,
    });

    const authorizationUrl = `${provider.oauth_authorization_url}?${params.toString()}`;

    return { authorizationUrl, state };
  }

  private async resolveOAuthProviderAndRedirect(
    input: CreateAuthorizationUrlInput,
  ): Promise<{ provider: LlmProvider; redirectUri: string }> {
    const provider = await this.providerRepo.findById(input.providerId);

    if (!provider || !provider.is_active) {
      throw new NotFoundException(
        `Provider with id '${input.providerId}' not found or inactive`,
      );
    }

    if (provider.auth_type !== 'oauth') {
      throw new BadRequestException(
        `Provider '${provider.name}' does not use OAuth authentication`,
      );
    }

    if (
      !provider.oauth_authorization_url ||
      !provider.oauth_token_url ||
      !provider.oauth_client_id
    ) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' is missing required OAuth registration fields`,
      );
    }

    const requestUri = input.redirectUri || undefined;
    const providerUri = provider.oauth_redirect_uri || undefined;

    if (requestUri && providerUri && requestUri !== providerUri) {
      throw new BadRequestException(
        `Request redirect URI does not match the provider's configured redirect URI`,
      );
    }

    const redirectUri = requestUri || providerUri;

    if (!redirectUri) {
      throw new UnprocessableEntityException(
        `No redirect URI available for provider '${provider.name}'`,
      );
    }

    return { provider, redirectUri };
  }

  async getStatus(providerId: string): Promise<OAuthStatusResult> {
    const provider = await this.providerRepo.findById(providerId);

    if (!provider || provider.auth_type !== 'oauth') {
      return { status: 'not_configured' };
    }

    if (!(await this.isDeviceFlow(provider))) {
      if (
        !provider.oauth_authorization_url ||
        !provider.oauth_token_url ||
        !provider.oauth_client_id
      ) {
        return { status: 'not_configured' };
      }
    }

    if (!provider.secret_id) {
      return { status: 'disconnected' };
    }

    const rawSecret = await this.fetchOAuthSecret(provider.secret_id);

    if (!rawSecret) {
      return { status: 'disconnected' };
    }

    return this.resolveOAuthTokenStatus(rawSecret.decryptedValue);
  }

  private async isDeviceFlow(provider: LlmProvider): Promise<boolean> {
    const piProvider = provider.runtime_env?.pi_provider;
    if (typeof piProvider !== 'string') {
      return false;
    }
    // Use the resolver so our overridden providers (e.g. the Anthropic
    // server-less provider with usesCallbackServer: false) are detected
    // correctly instead of falling through to the SDK's version which may declare
    // a loopback server.
    const oauthProvider = await this.oauthProviderResolver.resolve(piProvider);
    if (!oauthProvider) {
      return false;
    }
    return (
      oauthProvider.login.toString().includes('onDeviceCode') ||
      oauthProvider.usesCallbackServer === false
    );
  }

  private async fetchOAuthSecret(
    secretId: string,
  ): Promise<{ id: string; decryptedValue: string } | null> {
    try {
      return await this.secretCrud.findByIdRaw(secretId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private resolveOAuthTokenStatus(decryptedValue: string): OAuthStatusResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(decryptedValue);
    } catch {
      return { status: 'disconnected' };
    }

    if (!isRecord(parsed)) {
      return { status: 'disconnected' };
    }

    const oauth = parsed.oauth;

    if (!isRecord(oauth)) {
      return { status: 'disconnected' };
    }

    const expiresAt = oauth.expiresAt;

    if (typeof expiresAt === 'number') {
      if (expiresAt < Date.now()) {
        return { status: 'expired' };
      }
      return { status: 'connected' };
    }

    if (expiresAt === undefined) {
      return { status: 'connected' };
    }

    return { status: 'disconnected' };
  }

  async completeCallback(
    input: CompleteCallbackInput,
  ): Promise<CompleteCallbackResult> {
    const stateHash = sha256Base64Url(input.state);

    const session = await this.sessionRepo.findUnusedByStateHash(
      stateHash,
      new Date(),
    );

    if (!session) {
      throw new BadRequestException('Invalid or expired OAuth callback state');
    }

    const provider = await this.providerRepo.findById(session.provider_id);

    if (!provider) {
      throw new NotFoundException(
        `Provider with id '${session.provider_id}' not found`,
      );
    }

    if (!provider.is_active) {
      throw new NotFoundException(
        `Provider with id '${provider.id}' is not active`,
      );
    }

    if (provider.auth_type !== 'oauth') {
      throw new BadRequestException(
        `Provider '${provider.name}' does not use OAuth authentication`,
      );
    }

    if (!provider.oauth_token_url || !provider.oauth_client_id) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' is missing required OAuth registration fields`,
      );
    }

    if (!provider.secret_id) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' has no linked secret store entry`,
      );
    }

    this.assertSessionOwnerMatchesProvider(session, provider);

    const existingValue = await this.loadExistingSecretValue(
      provider.secret_id,
    );

    const clientSecret = await this.loadOAuthClientSecret(
      provider.oauth_client_secret_id,
    );

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: session.redirect_uri,
      client_id: provider.oauth_client_id,
      code_verifier: session.code_verifier,
    });

    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    let tokenResponse: unknown;

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, TOKEN_EXCHANGE_TIMEOUT_MS);

    try {
      const response = await fetch(provider.oauth_token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new BadRequestException('OAuth token exchange failed');
      }

      tokenResponse = await response.json();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const tokens = validateAuthorizationCodeTokenResponse(tokenResponse);

    const mergedValue = {
      ...existingValue,
      oauth: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        scope: tokens.scope,
        tokenType: tokens.token_type,
      },
    };

    await this.secretCrud.update(provider.secret_id, {
      value: mergedValue,
    });

    await this.sessionRepo.markUsed(session.id, new Date());

    return { status: 'connected' };
  }

  /**
   * Exchanges the stored refresh token for a fresh access token and persists the
   * rotated credential back to secret_store. Throws an actionable error if the
   * provider is not refreshable or the grant is rejected (caller surfaces it as
   * "needs re-auth").
   */
  async refreshAccessToken(
    provider: LlmProvider,
  ): Promise<RefreshedOAuthTokens> {
    if (provider.auth_type !== 'oauth') {
      throw new BadRequestException(
        `Provider '${provider.name}' does not use OAuth authentication`,
      );
    }
    if (!provider.secret_id) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' has no linked secret; re-authenticate it`,
      );
    }

    const existingValue = await this.loadExistingSecretValue(
      provider.secret_id,
    );
    const oauth = isRecord(existingValue.oauth)
      ? existingValue.oauth
      : undefined;
    const previousRefreshToken =
      oauth && typeof oauth.refreshToken === 'string'
        ? oauth.refreshToken
        : undefined;
    if (!previousRefreshToken) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' has no stored refresh token; re-authenticate it`,
      );
    }

    const refreshed = await this.computeRefreshedTokens(
      provider,
      oauth,
      previousRefreshToken,
    );

    await this.secretCrud.update(provider.secret_id, {
      value: { ...existingValue, oauth: { ...refreshed } },
    });

    return refreshed;
  }

  /**
   * Resolves the rotated tokens for `provider`, delegating to the pi OAuth
   * provider definition selected by `runtime_env.pi_provider` when one is
   * available (it supplies the client_id and provider-specific request shape
   * for subscription providers), and otherwise POSTing to the provider's
   * configured token endpoint.
   */
  private async computeRefreshedTokens(
    provider: LlmProvider,
    oauth: Record<string, unknown> | undefined,
    previousRefreshToken: string,
  ): Promise<RefreshedOAuthTokens> {
    const piProvider = provider.runtime_env?.pi_provider;
    if (typeof piProvider === 'string') {
      const oauthProvider =
        await this.oauthProviderResolver.resolve(piProvider);
      if (oauthProvider) {
        return this.refreshViaPiProvider(
          provider.name,
          oauthProvider,
          oauth,
          previousRefreshToken,
        );
      }
    }

    return this.refreshViaTokenEndpoint(provider, previousRefreshToken);
  }

  /**
   * Delegates the refresh to the resolved pi OAuth provider and maps its
   * credential shape back to {@link RefreshedOAuthTokens}, carrying forward
   * scope/token_type which the pi refresh does not return.
   */
  private async refreshViaPiProvider(
    providerName: string,
    oauthProvider: OAuthProviderInterface,
    oauth: Record<string, unknown> | undefined,
    previousRefreshToken: string,
  ): Promise<RefreshedOAuthTokens> {
    try {
      const next = await oauthProvider.refreshToken(
        buildPiRefreshCredentials(oauth, previousRefreshToken),
      );
      return mapPiCredentialsToRefreshedTokens(next, oauth);
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      throw new UnprocessableEntityException(
        `OAuth refresh for '${providerName}' failed; re-authenticate the provider`,
      );
    }
  }

  /**
   * Refreshes against the provider's own token endpoint with a form-encoded
   * `refresh_token` grant, for providers with no usable pi_provider delegation.
   */
  private async refreshViaTokenEndpoint(
    provider: LlmProvider,
    previousRefreshToken: string,
  ): Promise<RefreshedOAuthTokens> {
    if (!provider.oauth_token_url || !provider.oauth_client_id) {
      throw new UnprocessableEntityException(
        `Provider '${provider.name}' is missing OAuth token_url/client_id; re-authenticate it`,
      );
    }

    const clientSecret = await this.loadOAuthClientSecret(
      provider.oauth_client_secret_id,
    );

    return postRefreshTokenGrant({
      tokenUrl: provider.oauth_token_url,
      clientId: provider.oauth_client_id,
      clientSecret,
      previousRefreshToken,
      providerName: provider.name,
    });
  }

  /**
   * Ensures the provider's stored OAuth access token is fresh before it is read
   * for a runner launch. No-op for non-oauth providers and for tokens that are
   * not yet within the refresh buffer. Concurrent calls for the same provider
   * share one refresh.
   */
  async ensureFreshOAuthCredential(provider: LlmProvider): Promise<void> {
    if (provider.auth_type !== 'oauth' || !provider.secret_id) {
      return;
    }
    const secretId = provider.secret_id;

    const existing = this.inflightRefresh.get(provider.id);
    if (existing) {
      await existing;
      return;
    }

    const run = (async () => {
      const value = await this.loadExistingSecretValue(secretId);
      const oauth = isRecord(value.oauth) ? value.oauth : undefined;
      const expiresAt =
        oauth && typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0;
      if (!isOAuthTokenExpiring(expiresAt, Date.now())) {
        return;
      }
      await this.refreshAccessToken(provider);
    })();

    this.inflightRefresh.set(provider.id, run);
    try {
      await run;
    } finally {
      this.inflightRefresh.delete(provider.id);
    }
  }

  private assertSessionOwnerMatchesProvider(
    session: { owner_type: string; owner_id?: string | null },
    provider: { owner_type: string; owner_id?: string | null },
  ): void {
    if (session.owner_type !== provider.owner_type) {
      throw new BadRequestException(
        'Session owner does not match provider owner',
      );
    }

    const sessionOwnerId = session.owner_id ?? null;
    const providerOwnerId = provider.owner_id ?? null;
    if (sessionOwnerId !== providerOwnerId) {
      throw new BadRequestException(
        'Session owner does not match provider owner',
      );
    }
  }

  private async loadExistingSecretValue(
    secretId: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.secretCrud.findByIdRaw(secretId);

    if (!raw) {
      return {};
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw.decryptedValue);
    } catch {
      throw new UnprocessableEntityException(
        'Linked secret value is not valid JSON',
      );
    }

    if (!isRecord(parsed)) {
      return {};
    }

    return parsed;
  }

  private async loadOAuthClientSecret(
    clientSecretId: string | null | undefined,
  ): Promise<string | null> {
    if (!clientSecretId) {
      return null;
    }

    const raw = await this.secretCrud.findByIdRaw(clientSecretId);

    if (!raw) {
      throw new BadRequestException('OAuth client secret not found');
    }

    return parseClientSecretPayload(raw.decryptedValue);
  }
}
