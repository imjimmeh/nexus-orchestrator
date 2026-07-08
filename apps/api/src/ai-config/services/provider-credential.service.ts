import { BadRequestException, Injectable } from '@nestjs/common';
import type { CreateProviderRequest, UpdateProviderRequest } from '@nexus/core';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import type { LlmProvider } from '../database/entities/llm-provider.entity';
import {
  applyCredentialRuntimeEnv,
  buildSecretValueMap,
  deriveApiKeyField,
  headersToRecord,
} from './provider-credential.helpers';

type InlineCredential = NonNullable<CreateProviderRequest['credential']>;

const MANAGED_SECRET_SUFFIX = ' credentials';

@Injectable()
export class ProviderCredentialService {
  constructor(private readonly secrets: SecretCrudService) {}

  async applyOnCreate(
    data: CreateProviderRequest,
  ): Promise<CreateProviderRequest> {
    if (!data.credential) {
      return data;
    }
    const apiKeyField = deriveApiKeyField(data.provider_id);
    const value = this.buildValue(apiKeyField, data.credential);
    if (Object.keys(value).length === 0) {
      throw new BadRequestException(
        'An inline credential must include an API key or at least one value',
      );
    }
    const secret = await this.secrets.create({
      name: `${data.name}${MANAGED_SECRET_SUFFIX}`,
      value,
      metadata: { managed_by_provider: true, fields: Object.keys(value) },
    });
    return this.finalize(data, secret.id, apiKeyField, data.credential);
  }

  async applyOnUpdate(
    data: UpdateProviderRequest,
    existing: LlmProvider | null,
  ): Promise<UpdateProviderRequest> {
    if (!data.credential) {
      return data;
    }
    const apiKeyField = deriveApiKeyField(
      data.provider_id ?? existing?.provider_id,
    );
    const changed = this.buildValue(apiKeyField, data.credential);

    if (Object.keys(changed).length === 0) {
      throw new BadRequestException(
        'An inline credential must include an API key or at least one value',
      );
    }

    const existingSecretId = existing?.secret_id ?? null;

    let secretId: string;
    if (existingSecretId) {
      const raw = await this.secrets.findByIdRaw(existingSecretId);
      const current = this.parse(raw?.decryptedValue);
      const merged = { ...current, ...changed };
      await this.secrets.update(existingSecretId, {
        value: merged,
        metadata: { managed_by_provider: true, fields: Object.keys(merged) },
      });
      secretId = existingSecretId;
    } else {
      const secret = await this.secrets.create({
        name: `${data.name ?? existing?.name ?? 'provider'}${MANAGED_SECRET_SUFFIX}`,
        value: changed,
        metadata: { managed_by_provider: true, fields: Object.keys(changed) },
      });
      secretId = secret.id;
    }
    return this.finalize(
      data,
      secretId,
      apiKeyField,
      data.credential,
      existing?.runtime_env,
    );
  }

  private buildValue(
    apiKeyField: string,
    credential: InlineCredential,
  ): Record<string, string> {
    return buildSecretValueMap({
      apiKeyField,
      apiKey: credential.api_key,
      extra: credential.extra,
    });
  }

  private finalize<T extends CreateProviderRequest | UpdateProviderRequest>(
    data: T,
    secretId: string,
    apiKeyField: string,
    credential: InlineCredential,
    existingRuntimeEnv?: Record<string, unknown>,
  ): T {
    const { credential: _omit, ...rest } = data;
    return {
      ...(rest as T),
      secret_id: secretId,
      runtime_env: applyCredentialRuntimeEnv({
        runtimeEnv: data.runtime_env ?? existingRuntimeEnv,
        apiKeyField,
        headerRecord: headersToRecord(credential.headers),
      }),
    };
  }

  private parse(value?: string): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
