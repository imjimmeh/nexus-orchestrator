import { Injectable } from '@nestjs/common';
import type {
  CreateProviderRequest,
  ListProvidersQuery,
  UpdateProviderRequest,
} from '@nexus/core';
import { LlmProviderRepository } from '../../database/repositories/llm-provider.repository';
import { LlmProvider } from '../../database/entities/llm-provider.entity';
import { BaseCrudService } from './base-crud.service';
import { RunnerProviderSelectionService } from '../runner-provider-selection.service';

@Injectable()
export class ProviderCrudService extends BaseCrudService<
  LlmProvider,
  CreateProviderRequest,
  UpdateProviderRequest
> {
  constructor(
    repository: LlmProviderRepository,
    private readonly runnerProviderSelection: RunnerProviderSelectionService,
  ) {
    super(repository, 'Provider');
  }

  async create(data: CreateProviderRequest): Promise<LlmProvider> {
    const enriched =
      await this.enrichWithSynthesizedProviderConfig<CreateProviderRequest>(
        data,
      );
    return super.create(enriched);
  }

  async update(
    id: string,
    data: UpdateProviderRequest,
  ): Promise<LlmProvider | null> {
    const existing = await this.findById(id);
    const enriched =
      await this.enrichWithSynthesizedProviderConfig<UpdateProviderRequest>(
        data,
        existing,
      );
    return super.update(id, enriched);
  }

  async findAllPaginated(
    query: Omit<ListProvidersQuery, 'scopeNodeId'> & { scopeIds?: string[] },
  ): Promise<{ data: LlmProvider[]; total: number }> {
    const repo = this.repository as unknown as LlmProviderRepository;
    return repo.findAllPaginated(query);
  }

  private async enrichWithSynthesizedProviderConfig<
    T extends CreateProviderRequest | UpdateProviderRequest,
  >(data: T, existing?: LlmProvider | null): Promise<T> {
    const params = this.resolveOAuthSynthesisParams(data, existing);
    if (!params) {
      return data;
    }

    if (this.hasExplicitProviderConfig(params.runtimeEnv)) {
      return data;
    }

    const synthesized =
      await this.runnerProviderSelection.synthesizeOAuthProviderConfig(params);
    if (!synthesized) {
      return data;
    }

    return {
      ...data,
      runtime_env: {
        ...(params.runtimeEnv ?? {}),
        providerConfig: synthesized,
      },
    };
  }

  private resolveOAuthSynthesisParams(
    data: CreateProviderRequest | UpdateProviderRequest,
    existing?: LlmProvider | null,
  ):
    | {
        providerName: string;
        piProvider: string;
        oauthTokenUrl: string;
        runtimeEnv: Record<string, unknown> | undefined;
      }
    | undefined {
    const authType = data.auth_type ?? existing?.auth_type;
    if (authType !== 'oauth') {
      return undefined;
    }

    const runtimeEnv = data.runtime_env ?? existing?.runtime_env;
    const piProvider = this.resolveStringValue(
      data.runtime_env?.pi_provider,
      existing?.runtime_env?.pi_provider,
    );
    const oauthTokenUrl = this.resolveStringValue(
      data.oauth_token_url,
      existing?.oauth_token_url,
    );
    const providerName = this.resolveStringValue(data.name, existing?.name);

    if (!piProvider || !oauthTokenUrl || !providerName) {
      return undefined;
    }

    return { providerName, piProvider, oauthTokenUrl, runtimeEnv };
  }

  private resolveStringValue(
    primary: unknown,
    fallback: unknown,
  ): string | undefined {
    const value = primary ?? fallback;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private hasExplicitProviderConfig(
    runtimeEnv: Record<string, unknown> | undefined,
  ): boolean {
    return (
      this.isRecord(runtimeEnv?.providerConfig) ||
      this.isRecord(runtimeEnv?.provider_config)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
