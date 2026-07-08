import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import type { OAuthSessionStatus, OAuthStartResult } from '@nexus/core';
import { OAuthLoginService } from '../../oauth/oauth-login.service';

interface StartProviderOAuthInput {
  providerId: string;
  enterpriseUrl?: string;
}

/**
 * Bridges the provider page to the unified {@link OAuthLoginService}. Resolves
 * the pi-ai preset for a provider, guarantees a backing secret, and supplies a
 * sink that merges the minted OAuth tokens into that provider's secret.
 */
@Injectable()
export class ProviderOAuthLinkService {
  constructor(
    private readonly providerRepo: LlmProviderRepository,
    private readonly secretCrud: SecretCrudService,
    private readonly oauthLogin: OAuthLoginService,
  ) {}

  async start(input: StartProviderOAuthInput): Promise<OAuthStartResult> {
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

    const secretId = await this.ensureSecret(
      provider.id,
      provider.name,
      provider.secret_id,
    );
    const piProviderId =
      (provider.runtime_env?.pi_provider as string | undefined) ??
      provider.name.toLowerCase();

    return this.oauthLogin.start(
      { piProviderId, enterpriseUrl: input.enterpriseUrl },
      (credentials) => this.persistToProviderSecret(secretId, credentials),
    );
  }

  async submitCode(sessionId: string, code: string): Promise<void> {
    await this.oauthLogin.submitCode(sessionId, code);
  }

  sessionStatus(sessionId: string): Promise<OAuthSessionStatus> {
    return this.oauthLogin.getStatus(sessionId);
  }

  private async ensureSecret(
    providerId: string,
    providerName: string,
    existingSecretId: string | null | undefined,
  ): Promise<string> {
    if (existingSecretId) return existingSecretId;

    const slug = providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const secret = await this.secretCrud.create({
      name: `oauth-tokens-${slug}-${randomUUID().slice(0, 8)}`,
      value: {},
      metadata: {
        description: `OAuth tokens for provider: ${providerName}`,
        provider_id: providerId,
      },
    });
    const updated = await this.providerRepo.update(providerId, {
      secret_id: secret.id,
    });
    if (!updated) {
      throw new UnprocessableEntityException(
        `Failed to link OAuth secret to provider '${providerName}'`,
      );
    }
    return secret.id;
  }

  private async persistToProviderSecret(
    secretId: string,
    credentials: OAuthCredentials,
  ): Promise<void> {
    const raw = await this.secretCrud.findByIdRaw(secretId);
    let existing: Record<string, unknown> = {};
    if (raw) {
      try {
        existing = JSON.parse(raw.decryptedValue) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }

    await this.secretCrud.update(secretId, {
      value: {
        ...existing,
        oauth: {
          accessToken: credentials.access,
          refreshToken: credentials.refresh,
          expiresAt: credentials.expires,
        },
      },
    });
  }
}
