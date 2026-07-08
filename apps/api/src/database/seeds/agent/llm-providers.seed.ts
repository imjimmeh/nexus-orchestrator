import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LlmProvider } from '../../../ai-config/database/entities/llm-provider.entity';

const DEFAULT_PROVIDER_NAME = process.env.E2E_PROVIDER_NAME || 'chutes.ai';
const DEFAULT_PROVIDER_BASE_URL =
  process.env.E2E_PROVIDER_BASE_URL || 'https://llm.chutes.ai/v1/';

export const DEFAULT_LLM_PROVIDERS: Array<
  Partial<LlmProvider> & { name: string }
> = [
  {
    name: DEFAULT_PROVIDER_NAME,
    auth_type: 'api_key',
    secret_id: null,
    runtime_env: {
      OPENAI_BASE_URL: DEFAULT_PROVIDER_BASE_URL,
    },
    is_active: true,
  },
  {
    name: 'Anthropic (Claude Pro/Max)',
    provider_id: 'anthropic',
    auth_type: 'oauth',
    secret_id: null,
    oauth_client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    oauth_authorization_url: 'https://claude.ai/oauth/authorize',
    oauth_token_url: 'https://platform.claude.com/v1/oauth/token',
    oauth_redirect_uri: 'http://localhost:53692/callback',
    oauth_scopes: [
      'org:create_api_key',
      'user:profile',
      'user:inference',
      'user:sessions:claude_code',
      'user:mcp_servers',
      'user:file_upload',
    ],
    runtime_env: { pi_provider: 'anthropic' },
    is_active: true,
  },
];

@Injectable()
export class LlmProviderSeedService {
  private readonly logger = new Logger(LlmProviderSeedService.name);

  constructor(
    @InjectRepository(LlmProvider)
    private readonly repository: Repository<LlmProvider>,
  ) {}

  async seed(options?: { secretId?: string | null }): Promise<void> {
    const linkedSecretId = options?.secretId || null;

    for (const providerData of DEFAULT_LLM_PROVIDERS) {
      await this.upsertProvider(providerData, linkedSecretId);
    }
  }

  private async upsertProvider(
    providerData: Partial<LlmProvider> & { name: string },
    linkedSecretId: string | null,
  ): Promise<void> {
    const shouldLinkSecret =
      linkedSecretId !== null && providerData.auth_type === 'api_key';
    const providerWithSecret: Partial<LlmProvider> & { name: string } = {
      ...providerData,
      secret_id: shouldLinkSecret
        ? linkedSecretId
        : (providerData.secret_id ?? null),
    };

    const existing = await this.repository.findOne({
      where: { name: providerWithSecret.name, owner_type: 'global' },
    });

    if (existing) {
      await this.updateExistingProvider(
        existing,
        providerWithSecret,
        linkedSecretId,
      );
      return;
    }

    await this.repository.save(this.repository.create(providerWithSecret));
    this.logger.log(`Created LLM provider: ${providerWithSecret.name}`);
  }

  private async updateExistingProvider(
    existing: LlmProvider,
    newData: Partial<LlmProvider>,
    linkedSecretId: string | null,
  ): Promise<void> {
    const updates: Partial<LlmProvider> = this.getOAuthBackfillUpdates(
      existing,
      newData,
    );

    if (
      linkedSecretId !== null &&
      newData.auth_type === 'api_key' &&
      existing.secret_id !== linkedSecretId
    ) {
      updates.secret_id = linkedSecretId;
    }

    if (
      JSON.stringify(existing.runtime_env || {}) !==
      JSON.stringify(newData.runtime_env || {})
    ) {
      updates.runtime_env = newData.runtime_env || {};
    }

    if (existing.auth_type !== newData.auth_type) {
      updates.auth_type = newData.auth_type;
    }

    if (existing.is_active !== newData.is_active) {
      updates.is_active = newData.is_active ?? existing.is_active;
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(existing, updates);
      await this.repository.save(existing);
      this.logger.log(`Updated LLM provider: ${newData.name}`);
    }
  }

  private getOAuthBackfillUpdates(
    existing: LlmProvider,
    newData: Partial<LlmProvider>,
  ): Partial<LlmProvider> {
    const updates: Partial<LlmProvider> = {};
    const oauthFields: Array<keyof LlmProvider> = [
      'oauth_client_id',
      'oauth_authorization_url',
      'oauth_token_url',
      'oauth_redirect_uri',
      'oauth_scopes',
    ];

    for (const key of oauthFields) {
      const value = newData[key];
      if (value === undefined) continue;
      const current = existing[key];
      const serializedCurrent = Array.isArray(current)
        ? JSON.stringify(current)
        : current;
      const serializedValue = Array.isArray(value)
        ? JSON.stringify(value)
        : value;
      if (serializedCurrent !== serializedValue) {
        (updates as Record<string, unknown>)[key] = value;
      }
    }

    return updates;
  }
}

export async function seedLlmProviders(
  dataSource: DataSource,
  options?: { secretId?: string | null },
): Promise<void> {
  const service = new LlmProviderSeedService(
    dataSource.getRepository(LlmProvider),
  );
  await service.seed(options);
}
