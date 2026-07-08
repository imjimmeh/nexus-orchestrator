import { describe, it, expect, vi } from 'vitest';
import { HarnessCredentialController } from './harness-credential.controller';
import type { HarnessProviderRegistryService } from './harness-provider-registry.service';
import type { HarnessCredentialBindingRepository } from './harness-credential-binding.repository';
import type { UpsertHarnessCredentialBinding } from './harness-credential-binding.types';
import type { ScopeService } from '../scope/scope.service';

function makeController(overrides?: {
  requirements?: unknown[];
  binding?: unknown;
}) {
  const registry = {
    resolve: vi.fn(() => ({
      capabilities: { requiredCredentials: overrides?.requirements ?? [] },
    })),
  } as unknown as HarnessProviderRegistryService;
  const bindings = {
    findForScopeChain: vi.fn(async () => overrides?.binding ?? null),
    upsert: vi.fn(async (b: UpsertHarnessCredentialBinding) => ({
      id: 'new-binding',
      ...b,
    })),
    findBinding: vi.fn(async () => overrides?.binding ?? null),
    remove: vi.fn(async () => undefined),
  } as unknown as HarnessCredentialBindingRepository;
  const scope = {
    getAncestorIds: vi.fn(async (id: string) => [id]),
  } as unknown as ScopeService;
  return {
    controller: new HarnessCredentialController(registry, bindings, scope),
    registry,
    bindings,
    scope,
  };
}

describe('HarnessCredentialController', () => {
  it('GET lists requirements with binding status', async () => {
    const { controller } = makeController({
      requirements: [
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ],
      binding: { id: 'b1', secretId: 's1', authType: 'api_key' },
    });

    const result = await controller.listCredentials('claude-code', undefined);

    expect(result).toEqual([
      expect.objectContaining({
        key: 'anthropic',
        bound: true,
        boundAuthType: 'api_key',
      }),
    ]);
  });

  it('GET marks an unbound requirement as bound:false', async () => {
    const { controller } = makeController({
      requirements: [
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ],
      binding: null,
    });

    const result = await controller.listCredentials('claude-code', undefined);

    expect(result[0]).toEqual(
      expect.objectContaining({ key: 'anthropic', bound: false }),
    );
  });

  it('PUT binds a credential to a secret', async () => {
    const { controller, bindings } = makeController();

    const result = await controller.bindCredential('claude-code', 'anthropic', {
      authType: 'api_key',
      secretId: 's1',
      scopeNodeId: null,
    });

    expect(bindings.upsert).toHaveBeenCalledWith({
      scopeNodeId: null,
      harnessId: 'claude-code',
      credentialKey: 'anthropic',
      authType: 'api_key',
      secretId: 's1',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'new-binding' }));
  });

  it('GET builds scope chain leaf-first when scopeNodeId has ancestors', async () => {
    const { controller, bindings, scope } = makeController({
      requirements: [
        {
          key: 'anthropic',
          displayName: 'A',
          authTypes: ['api_key'],
          primary: true,
        },
      ],
      binding: null,
    });
    // Override scope mock to return ancestors root-first
    vi.mocked(scope.getAncestorIds).mockResolvedValue([
      'root',
      'parent',
      'leaf',
    ]);

    await controller.listCredentials('claude-code', 'leaf');

    // Chain should be leaf-first (reversed) then null
    expect(bindings.findForScopeChain).toHaveBeenCalledWith(
      ['leaf', 'parent', 'root', null],
      'claude-code',
      'anthropic',
    );
  });

  it('DELETE unbinds a credential', async () => {
    const { controller, bindings } = makeController({
      binding: { id: 'b1' },
    });

    await controller.unbindCredential('claude-code', 'anthropic', undefined);

    expect(bindings.findBinding).toHaveBeenCalledWith(
      null,
      'claude-code',
      'anthropic',
    );
    expect(bindings.remove).toHaveBeenCalledWith('b1');
  });
});
