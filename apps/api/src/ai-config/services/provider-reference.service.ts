import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import type { LlmProvider } from '../database/entities/llm-provider.entity';
import type { ProviderReferenceInput } from './provider-reference.service.types';

@Injectable()
export class ProviderReferenceService {
  constructor(private readonly providers: LlmProviderRepository) {}

  async resolve(input: ProviderReferenceInput): Promise<LlmProvider> {
    if (input.providerId) {
      return this.resolveById(input.providerId);
    }

    if (input.providerSource && input.providerName) {
      return this.resolveBySourceAndName(
        input.providerSource,
        input.providerName,
        input.executionContext,
      );
    }

    if (input.providerName) {
      return this.resolveByContextualName(
        input.providerName,
        input.executionContext,
      );
    }

    throw new NotFoundException('No provider identifying fields provided');
  }

  private async resolveById(providerId: string): Promise<LlmProvider> {
    const provider = await this.providers.findById(providerId);

    if (!provider || !provider.is_active) {
      throw new NotFoundException(
        `Provider with id '${providerId}' not found or inactive`,
      );
    }

    return provider;
  }

  private async resolveBySourceAndName(
    source: 'global' | 'user' | 'scope',
    name: string,
    executionContext?: ProviderReferenceInput['executionContext'],
  ): Promise<LlmProvider> {
    const ownerId =
      source !== 'global' ? (executionContext?.ownerId ?? null) : null;

    const provider = await this.providers.findActiveByOwnerAndName({
      ownerType: source,
      ownerId,
      name,
    });

    if (!provider) {
      throw new NotFoundException(
        `Active provider '${name}' not found for ${source}`,
      );
    }

    return provider;
  }

  private async resolveByContextualName(
    name: string,
    executionContext?: ProviderReferenceInput['executionContext'],
  ): Promise<LlmProvider> {
    if (executionContext && executionContext.ownerType !== 'global') {
      const provider = await this.providers.findActiveByOwnerAndName({
        ownerType: executionContext.ownerType,
        ownerId: executionContext.ownerId ?? null,
        name,
      });

      if (provider) {
        return provider;
      }
    }

    const globalProvider = await this.providers.findActiveByOwnerAndName({
      ownerType: 'global',
      ownerId: null,
      name,
    });

    if (!globalProvider) {
      throw new NotFoundException(
        `Active provider '${name}' not found in context or globally`,
      );
    }

    return globalProvider;
  }
}
