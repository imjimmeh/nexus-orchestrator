import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  HarnessAuthType,
  HarnessCredentialRequirement,
  HarnessId,
  OAuthSessionStatus,
  OAuthStartResult,
  RunnerOAuthAuth,
} from '@nexus/core';
import type { OAuthCredentials } from '@earendil-works/pi-ai/oauth';
import { SecretCrudService } from '../security/services/secret-crud.service.js';
import { OAuthLoginService } from '../oauth/oauth-login.service.js';
import { HarnessCredentialBindingRepository } from './harness-credential-binding.repository.js';
import { HarnessProviderRegistryService } from './harness-provider-registry.service.js';
import type { HarnessOAuthStartParams } from './harness-oauth-link.service.types.js';

const OAUTH_AUTH_TYPES: HarnessAuthType[] = ['oauth_authcode', 'oauth_device'];

/**
 * Bridges harness credential bindings to the unified {@link OAuthLoginService}.
 * Resolves the pi-ai preset declared by a credential requirement and, on
 * success, mints a secret and upserts a scoped {@link HarnessCredentialBinding}.
 */
@Injectable()
export class HarnessOAuthLinkService {
  constructor(
    private readonly oauthLogin: OAuthLoginService,
    private readonly registry: HarnessProviderRegistryService,
    private readonly secrets: SecretCrudService,
    private readonly bindings: HarnessCredentialBindingRepository,
  ) {}

  async start(params: HarnessOAuthStartParams): Promise<OAuthStartResult> {
    const requirement = this.resolveOAuthRequirement(
      params.harnessId,
      params.credentialKey,
    );
    const authType =
      requirement.authTypes.find((t) => OAUTH_AUTH_TYPES.includes(t)) ??
      'oauth_authcode';

    return this.oauthLogin.start(
      { piProviderId: requirement.oauthProviderId as string },
      (credentials) => this.persistBinding(params, authType, credentials),
    );
  }

  async submitCode(sessionId: string, code: string): Promise<void> {
    await this.oauthLogin.submitCode(sessionId, code);
  }

  sessionStatus(sessionId: string): Promise<OAuthSessionStatus> {
    return this.oauthLogin.getStatus(sessionId);
  }

  private resolveOAuthRequirement(
    harnessId: HarnessId,
    credentialKey: string,
  ): HarnessCredentialRequirement {
    const requirements =
      this.registry.resolve(harnessId).capabilities.requiredCredentials ?? [];
    const requirement = requirements.find((r) => r.key === credentialKey);
    if (!requirement) {
      throw new BadRequestException(
        `Harness ${harnessId} has no credential requirement '${credentialKey}'`,
      );
    }
    const supportsOAuth = requirement.authTypes.some((t) =>
      OAUTH_AUTH_TYPES.includes(t),
    );
    if (!supportsOAuth || !requirement.oauthProviderId) {
      throw new BadRequestException(
        `Credential '${credentialKey}' on harness ${harnessId} does not support OAuth login`,
      );
    }
    return requirement;
  }

  private async persistBinding(
    params: HarnessOAuthStartParams,
    authType: HarnessAuthType,
    credentials: OAuthCredentials,
  ): Promise<void> {
    const auth: RunnerOAuthAuth = {
      type: 'oauth',
      credential: {
        type: 'oauth',
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      },
    };

    const secret = await this.secrets.create({
      name: `harness:${params.harnessId}:${params.credentialKey}:${randomUUID()}`,
      value: auth as unknown as Record<string, unknown>,
    });

    await this.bindings.upsert({
      scopeNodeId: params.scopeNodeId,
      harnessId: params.harnessId,
      credentialKey: params.credentialKey,
      authType,
      secretId: secret.id,
    });
  }
}
