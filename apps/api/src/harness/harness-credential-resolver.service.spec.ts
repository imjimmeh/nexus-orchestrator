import { describe, it, expect, vi } from 'vitest';
import type { RunnerProviderAuth } from '@nexus/core';
import { HarnessCredentialResolverService } from './harness-credential-resolver.service';

const EMPTY_AUTH: RunnerProviderAuth = { type: 'api_key', apiKey: '' };

function makeRegistry(requiredCredentials: unknown) {
  return {
    resolve: vi.fn(() => ({
      capabilities: { requiredCredentials },
    })),
  } as never;
}

function makeScope(chain: Record<string, string[]>) {
  return {
    getAncestorIds: vi.fn(async (id: string) => chain[id] ?? [id]),
  } as never;
}

function makeSecrets(values: Record<string, RunnerProviderAuth>) {
  return {
    findByIdRaw: vi.fn(async (id: string) =>
      values[id] ? { id, decryptedValue: JSON.stringify(values[id]) } : null,
    ),
  } as never;
}

describe('HarnessCredentialResolverService.resolvePrimaryAuth', () => {
  it('(a) overrides providerAuth when a binding is present', async () => {
    const bound: RunnerProviderAuth = { type: 'api_key', apiKey: 'BOUND' };
    const bindings = {
      findForScopeChain: vi.fn(async () => ({
        secretId: 's1',
        authType: 'api_key',
      })),
    } as never;
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ]),
      bindings,
      makeScope({}),
      makeSecrets({ s1: bound }),
    );

    const result = await sut.resolvePrimaryAuth({
      harnessId: 'claude-code',
      providerAuth: { type: 'api_key', apiKey: 'PROVIDER' },
    });

    expect(result).toEqual(bound);
  });

  it('(b) falls back to providerAuth when no binding exists', async () => {
    const provider: RunnerProviderAuth = {
      type: 'api_key',
      apiKey: 'PROVIDER',
    };
    const bindings = {
      findForScopeChain: vi.fn(async () => null),
    } as never;
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ]),
      bindings,
      makeScope({}),
      makeSecrets({}),
    );

    const result = await sut.resolvePrimaryAuth({
      harnessId: 'claude-code',
      providerAuth: provider,
    });

    expect(result).toEqual(provider);
  });

  it('(c) picks the most-specific scope binding (most-specific → platform → null)', async () => {
    const specific: RunnerProviderAuth = {
      type: 'api_key',
      apiKey: 'SPECIFIC',
    };
    const findForScopeChain = vi.fn(async () => ({
      secretId: 's-specific',
      authType: 'api_key' as const,
    }));
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ]),
      { findForScopeChain } as never,
      makeScope({ leaf: ['root', 'leaf'] }),
      makeSecrets({ 's-specific': specific }),
    );

    const result = await sut.resolvePrimaryAuth({
      harnessId: 'claude-code',
      scopeNodeId: 'leaf',
      providerAuth: { type: 'api_key', apiKey: 'PROVIDER' },
    });

    expect(result).toEqual(specific);
    // Assert the scope chain was built correctly (most-specific → platform → null)
    expect(findForScopeChain).toHaveBeenCalledWith(
      ['leaf', 'root', null],
      'claude-code',
      'anthropic',
    );
  });

  it('(d) throws when a required primary is unbound and providerAuth is empty', async () => {
    const bindings = {
      findForScopeChain: vi.fn(async () => null),
    } as never;
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ]),
      bindings,
      makeScope({}),
      makeSecrets({}),
    );

    await expect(
      sut.resolvePrimaryAuth({
        harnessId: 'claude-code',
        providerAuth: EMPTY_AUTH,
      }),
    ).rejects.toThrow(
      'Harness "claude-code" requires credential "anthropic" but no binding or provider credential is available',
    );
  });

  it('does not throw for an optional unbound primary with empty providerAuth', async () => {
    const bindings = {
      findForScopeChain: vi.fn(async () => null),
    } as never;
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
          optional: true,
        },
      ]),
      bindings,
      makeScope({}),
      makeSecrets({}),
    );

    const result = await sut.resolvePrimaryAuth({
      harnessId: 'claude-code',
      providerAuth: EMPTY_AUTH,
    });

    expect(result).toEqual(EMPTY_AUTH);
  });
});

describe('HarnessCredentialResolverService.resolveAll', () => {
  it('returns non-primary resolved credentials keyed by requirement key', async () => {
    const extraAuth: RunnerProviderAuth = { type: 'api_key', apiKey: 'EXTRA' };
    const findForScopeChain = vi.fn(
      async (_ids: unknown, _harness: unknown, key: string) =>
        key === 'extra' ? { secretId: 's-extra', authType: 'api_key' } : null,
    );
    const sut = new HarnessCredentialResolverService(
      makeRegistry([
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
        { key: 'extra', displayName: 'Extra', authTypes: ['api_key'] },
      ]),
      { findForScopeChain } as never,
      makeScope({}),
      makeSecrets({ 's-extra': extraAuth }),
    );

    const result = await sut.resolveAll({ harnessId: 'claude-code' });

    expect(result).toEqual({
      extra: { key: 'extra', authType: 'api_key', auth: extraAuth },
    });
  });
});
