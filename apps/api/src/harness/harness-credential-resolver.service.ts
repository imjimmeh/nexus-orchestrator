import { Inject, Injectable } from '@nestjs/common';
import type {
  HarnessCredentialRequirement,
  HarnessId,
  ResolvedHarnessCredential,
  RunnerProviderAuth,
} from '@nexus/core';
import { ScopeService } from '../scope/scope.service.js';
import { SecretCrudService } from '../security/services/secret-crud.service.js';
import { HarnessCredentialBindingRepository } from './harness-credential-binding.repository.js';
import { HarnessProviderRegistryService } from './harness-provider-registry.service.js';

interface RequirementSource {
  resolve(harnessId: HarnessId): {
    capabilities: { requiredCredentials?: HarnessCredentialRequirement[] };
  };
}

interface ResolvePrimaryAuthParams {
  harnessId: HarnessId;
  scopeNodeId?: string;
  providerAuth: RunnerProviderAuth;
}

interface ResolveAllParams {
  harnessId: HarnessId;
  scopeNodeId?: string;
}

/**
 * True when the auth payload is the empty api_key placeholder.
 * Only `api_key` payloads can be "empty" — OAuth credentials always carry a
 * non-empty token, so they never block launch via this guard.
 */
export function isEmptyAuth(auth: RunnerProviderAuth): boolean {
  return auth.type === 'api_key' && auth.apiKey.trim().length === 0;
}

@Injectable()
export class HarnessCredentialResolverService {
  constructor(
    @Inject(HarnessProviderRegistryService)
    private readonly registry: HarnessProviderRegistryService &
      RequirementSource,
    private readonly bindings: HarnessCredentialBindingRepository,
    private readonly scope: ScopeService,
    private readonly secrets: SecretCrudService,
  ) {}

  async resolvePrimaryAuth(
    params: ResolvePrimaryAuthParams,
  ): Promise<RunnerProviderAuth> {
    const primary = this.requirements(params.harnessId).find(
      (req) => req.primary,
    );
    if (!primary) return params.providerAuth;

    const resolved = await this.resolveRequirement(
      params.harnessId,
      params.scopeNodeId,
      primary,
    );
    if (resolved) return resolved.auth;

    if (!primary.optional && isEmptyAuth(params.providerAuth)) {
      throw new Error(
        `Harness "${params.harnessId}" requires credential "${primary.key}" but no binding or provider credential is available`,
      );
    }
    return params.providerAuth;
  }

  async resolveAll(
    params: ResolveAllParams,
  ): Promise<Record<string, ResolvedHarnessCredential>> {
    const extras = this.requirements(params.harnessId).filter(
      (req) => !req.primary,
    );
    const result: Record<string, ResolvedHarnessCredential> = {};
    for (const req of extras) {
      const resolved = await this.resolveRequirement(
        params.harnessId,
        params.scopeNodeId,
        req,
      );
      if (resolved) result[req.key] = resolved;
    }
    return result;
  }

  private requirements(harnessId: HarnessId): HarnessCredentialRequirement[] {
    return (
      this.registry.resolve(harnessId).capabilities.requiredCredentials ?? []
    );
  }

  private async resolveRequirement(
    harnessId: HarnessId,
    scopeNodeId: string | undefined,
    requirement: HarnessCredentialRequirement,
  ): Promise<ResolvedHarnessCredential | null> {
    const chain = await this.buildScopeChain(scopeNodeId);
    const binding = await this.bindings.findForScopeChain(
      chain,
      harnessId,
      requirement.key,
    );
    if (!binding) return null;

    const raw = await this.secrets.findByIdRaw(binding.secretId);
    if (!raw) return null;

    const auth = JSON.parse(raw.decryptedValue) as RunnerProviderAuth;
    return { key: requirement.key, authType: binding.authType, auth };
  }

  /** Most-specific -> platform -> null. */
  private async buildScopeChain(
    scopeNodeId: string | undefined,
  ): Promise<Array<string | null>> {
    if (!scopeNodeId) return [null];
    const ancestorsRootFirst = await this.scope.getAncestorIds(scopeNodeId);
    const mostSpecificFirst = [...ancestorsRootFirst].reverse();
    return [...mostSpecificFirst, null];
  }
}
