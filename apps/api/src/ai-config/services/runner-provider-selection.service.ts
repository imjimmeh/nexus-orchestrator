import { Injectable } from '@nestjs/common';
import type {
  RunnerOAuthCredential,
  RunnerProviderAuth,
  RunnerProviderModelConfig,
  RunnerProviderRegistrationConfig,
} from '@nexus/core';
import type { LlmProvider } from '../database/entities/llm-provider.entity';
import {
  asFiniteNumber,
  asJsonRecord,
  asModelInputArray,
  asNonEmptyString,
  asOptionalBoolean,
  asRecord,
  asStringRecord,
  asThinkingLevelMap,
  compactRecord,
  firstFiniteNumber,
  firstNonEmptyString,
  firstRecord,
  interpolateHeaders,
} from './runner-provider-selection.helpers';

type ProviderRawConfig = Record<string, unknown>;

@Injectable()
export class RunnerProviderSelectionService {
  removeOAuthCredentialEnv(
    providerEnv: Record<string, string>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(providerEnv).filter(
        ([key]) =>
          !/(access[_-]?token|refresh[_-]?token|expires[_-]?at|oauth)$/i.test(
            key,
          ),
      ),
    );
  }

  resolveRunnerProviderAuth(params: {
    provider: LlmProvider;
    resolvedProvider: string;
    providerEnv: Record<string, string>;
    runtimeEnv: ProviderRawConfig;
    secretMap: ProviderRawConfig;
    apiKeyField?: string;
    resolveApiKey: (params: {
      provider: string;
      providerEnv: Record<string, string>;
      apiKeyField?: string;
    }) => string;
  }): RunnerProviderAuth {
    if (params.provider.auth_type === 'oauth') {
      return {
        type: 'oauth',
        credential: this.resolveOAuthCredential({
          providerName: params.provider.name,
          runtimeEnv: params.runtimeEnv,
          secretMap: params.secretMap,
        }),
      };
    }

    return {
      type: 'api_key',
      apiKey: params.resolveApiKey({
        provider: params.resolvedProvider,
        providerEnv: params.providerEnv,
        apiKeyField: params.apiKeyField,
      }),
    };
  }

  resolveProviderRegistrationConfig(params: {
    auth: RunnerProviderAuth;
    baseUrl?: string;
    runtimeEnv: ProviderRawConfig;
    secretMap: ProviderRawConfig;
  }): RunnerProviderRegistrationConfig | undefined {
    const sourceRecord = firstRecord([
      params.runtimeEnv.providerConfig,
      params.runtimeEnv.provider_config,
      params.secretMap.providerConfig,
      params.secretMap.provider_config,
    ]);
    if (!sourceRecord && params.auth.type === 'api_key') {
      return undefined;
    }

    const source = sourceRecord ?? {};

    const oauth = this.resolveOAuthProviderConfig({
      auth: params.auth,
      source,
      runtimeEnv: params.runtimeEnv,
      secretMap: params.secretMap,
    });
    const models = this.asProviderModelArray(source.models);
    const baseUrl = this.normalizeBaseUrl(
      asNonEmptyString(source.baseUrl) ||
        asNonEmptyString(source.base_url) ||
        params.baseUrl,
    );
    const config: RunnerProviderRegistrationConfig = {
      name: asNonEmptyString(source.name),
      baseUrl,
      api: asNonEmptyString(source.api),
      headers: interpolateHeaders(
        asStringRecord(source.headers),
        params.secretMap,
      ),
      authHeader: asOptionalBoolean(source.authHeader ?? source.auth_header),
      oauth,
      models,
    };

    const compact = Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined),
    ) as RunnerProviderRegistrationConfig;

    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  async synthesizeOAuthProviderConfig(params: {
    providerName: string;
    piProvider: string;
    oauthTokenUrl: string;
  }): Promise<RunnerProviderRegistrationConfig | undefined> {
    let models: unknown[];
    try {
      const { getModels } = await import('@earendil-works/pi-ai');
      models = (getModels as (provider: string) => unknown[])(
        params.piProvider,
      );
    } catch {
      return undefined;
    }

    if (!Array.isArray(models) || models.length === 0) {
      return undefined;
    }

    const firstModel = asRecord(models[0]);
    if (!firstModel) {
      return undefined;
    }

    const baseUrl = asNonEmptyString(firstModel.baseUrl);
    const api = asNonEmptyString(firstModel.api);

    if (!baseUrl || !api) {
      return undefined;
    }

    return {
      name: params.providerName,
      baseUrl,
      api,
      authHeader: true,
      oauth: {
        name: params.providerName,
        refresh: {
          tokenUrl: params.oauthTokenUrl,
          refreshTokenParam: 'refresh_token',
          accessTokenPath: 'access_token',
          refreshTokenPath: 'refresh_token',
          expiresInPath: 'expires_in',
        },
      },
      models: models as RunnerProviderRegistrationConfig['models'],
    };
  }

  private resolveOAuthCredential(params: {
    providerName: string;
    runtimeEnv: ProviderRawConfig;
    secretMap: ProviderRawConfig;
  }): RunnerOAuthCredential {
    const source = firstRecord([
      params.secretMap.oauth,
      params.secretMap.oauth_credential,
      params.runtimeEnv.oauth,
      params.runtimeEnv.oauth_credential,
    ]);

    if (!source) {
      throw new Error(
        `OAuth provider '${params.providerName}' is missing credential object`,
      );
    }

    const refreshToken = firstNonEmptyString([
      source.refreshToken,
      source.refresh_token,
    ]);
    const accessToken = firstNonEmptyString([
      source.accessToken,
      source.access_token,
    ]);
    const expiresAt = firstFiniteNumber([
      source.expiresAt,
      source.expires_at,
      source.expires,
    ]);
    const missing = [
      refreshToken ? undefined : 'refreshToken',
      accessToken ? undefined : 'accessToken',
      expiresAt === undefined ? 'expiresAt' : undefined,
    ].filter((value): value is string => value !== undefined);

    if (
      missing.length > 0 ||
      !refreshToken ||
      !accessToken ||
      expiresAt === undefined
    ) {
      throw new Error(
        `OAuth provider '${params.providerName}' is missing credential field(s): ${missing.join(', ')}`,
      );
    }

    return {
      type: 'oauth',
      refreshToken,
      accessToken,
      expiresAt,
    };
  }

  private resolveOAuthProviderConfig(params: {
    auth: RunnerProviderAuth;
    source: ProviderRawConfig;
    runtimeEnv: ProviderRawConfig;
    secretMap: ProviderRawConfig;
  }): RunnerProviderRegistrationConfig['oauth'] {
    const oauthSource = firstRecord([
      params.source.oauth,
      params.runtimeEnv.oauthProvider,
      params.runtimeEnv.oauth_provider,
      params.secretMap.oauthProvider,
      params.secretMap.oauth_provider,
    ]);

    if (!oauthSource) {
      if (params.auth.type === 'oauth') {
        throw new Error(
          'OAuth provider registration metadata is required for OAuth runner providers',
        );
      }
      return undefined;
    }

    const refreshSource = asRecord(oauthSource.refresh);
    if (!refreshSource) {
      throw new Error(
        'OAuth provider registration metadata is missing refresh config',
      );
    }

    const tokenUrl = asNonEmptyString(
      refreshSource.tokenUrl ?? refreshSource.token_url,
    );
    if (!tokenUrl) {
      throw new Error('OAuth refresh config is missing tokenUrl');
    }

    return {
      name: asNonEmptyString(oauthSource.name) ?? 'OAuth Provider',
      refresh: compactRecord({
        tokenUrl,
        method: refreshSource.method === 'POST' ? ('POST' as const) : undefined,
        headers: asStringRecord(refreshSource.headers),
        body: asJsonRecord(refreshSource.body),
        refreshTokenParam: asNonEmptyString(
          refreshSource.refreshTokenParam ?? refreshSource.refresh_token_param,
        ),
        accessTokenPath: asNonEmptyString(
          refreshSource.accessTokenPath ?? refreshSource.access_token_path,
        ),
        refreshTokenPath: asNonEmptyString(
          refreshSource.refreshTokenPath ?? refreshSource.refresh_token_path,
        ),
        expiresInPath: asNonEmptyString(
          refreshSource.expiresInPath ?? refreshSource.expires_in_path,
        ),
        expiresAtPath: asNonEmptyString(
          refreshSource.expiresAtPath ?? refreshSource.expires_at_path,
        ),
      }),
    };
  }

  private asProviderModelArray(
    value: unknown,
  ): RunnerProviderModelConfig[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.map((entry, index) => {
      const model = asRecord(entry);
      if (!model) {
        throw new Error(
          `Provider model config at index ${index.toString()} must be an object`,
        );
      }

      const id = asNonEmptyString(model.id);
      const name = asNonEmptyString(model.name);
      const reasoning = asOptionalBoolean(model.reasoning);
      const cost = asRecord(model.cost);
      const contextWindow = firstFiniteNumber([
        model.contextWindow,
        model.context_window,
      ]);
      const maxTokens = firstFiniteNumber([model.maxTokens, model.max_tokens]);

      if (
        !id ||
        !name ||
        reasoning === undefined ||
        !cost ||
        contextWindow === undefined ||
        maxTokens === undefined
      ) {
        throw new Error(
          `Provider model config at index ${index.toString()} is missing required fields`,
        );
      }

      return compactRecord({
        id,
        name,
        api: asNonEmptyString(model.api),
        baseUrl: this.normalizeBaseUrl(
          asNonEmptyString(model.baseUrl ?? model.base_url),
        ),
        reasoning,
        thinkingLevelMap: asThinkingLevelMap(
          model.thinkingLevelMap ?? model.thinking_level_map,
        ),
        input: asModelInputArray(model.input),
        cost: {
          input: this.requireNumber(cost.input, 'cost.input'),
          output: this.requireNumber(cost.output, 'cost.output'),
          cacheRead: this.requireNumber(
            cost.cacheRead ?? cost.cache_read,
            'cost.cacheRead',
          ),
          cacheWrite: this.requireNumber(
            cost.cacheWrite ?? cost.cache_write,
            'cost.cacheWrite',
          ),
        },
        contextWindow,
        maxTokens,
        headers: asStringRecord(model.headers),
        compat: asJsonRecord(model.compat),
      });
    });
  }

  private requireNumber(value: unknown, label: string): number {
    const parsed = asFiniteNumber(value);
    if (parsed === undefined) {
      throw new Error(
        `Provider model config is missing numeric field ${label}`,
      );
    }
    return parsed;
  }

  private normalizeBaseUrl(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    return value.replaceAll(/\/+$/g, '');
  }
}
