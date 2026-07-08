import { describe, it, expect, vi } from 'vitest';
import { HarnessConfigService } from './harness-config.service';
import type { HarnessCredentialResolverService } from './harness-credential-resolver.service';
import type { HarnessHttpClient } from './harness-http-client.types';

function makeFakeRepo(seed: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...seed };
  return {
    find: vi.fn(async () => Object.values(store)),
    findByHarnessId: vi.fn(async (id: string) => (store[id] as never) ?? null),
    save: vi.fn(async (e: { harnessId: string }) => {
      store[e.harnessId] = e;
      return e;
    }),
    remove: vi.fn(async (id: string) => {
      Reflect.deleteProperty(store, id);
    }),
  };
}

function makeResolver(
  resolveAll: () => Promise<Record<string, unknown>> = async () => ({}),
): HarnessCredentialResolverService {
  return {
    resolveAll: vi.fn(resolveAll),
  } as unknown as HarnessCredentialResolverService;
}

function makeHttpClient(get: HarnessHttpClient['get']): HarnessHttpClient {
  return { get: vi.fn(get) };
}

function makeService(opts?: {
  repo?: ReturnType<typeof makeFakeRepo>;
  resolver?: HarnessCredentialResolverService;
  http?: HarnessHttpClient;
}): HarnessConfigService {
  return new HarnessConfigService(
    (opts?.repo ?? makeFakeRepo()) as never,
    opts?.resolver ?? makeResolver(),
    opts?.http ??
      makeHttpClient(async () => ({
        ok: false,
        status: 0,
        json: async () => null,
      })),
  );
}

describe('HarnessConfigService', () => {
  it('creates a custom definition', async () => {
    const svc = makeService();
    const created = await svc.create({
      harnessId: 'custom:acme',
      displayName: 'Acme',
      imageRef: 'acme/h:1',
      transport: 'kernel',
      capabilities: {} as never,
    });
    expect(created.source).toBe('custom');
    expect(created.enabled).toBe(true);
  });

  it('rejects editing a builtin', async () => {
    const svc = makeService();
    await expect(svc.update('pi', { displayName: 'x' })).rejects.toThrow(
      /builtin/i,
    );
  });

  it('rejects removing a builtin', async () => {
    const svc = makeService();
    await expect(svc.remove('pi')).rejects.toThrow(/builtin/i);
  });

  describe('validate', () => {
    it('external-reachable: probes {baseUrl}/health and reports capabilities', async () => {
      const repo = makeFakeRepo({
        'custom:ext': {
          harnessId: 'custom:ext',
          transport: 'external',
          imageRef: '',
          endpointConfig: { baseUrl: 'https://ext.test' },
        },
      });
      const http = makeHttpClient(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          capabilities: { toolModel: 'permission_callback' },
        }),
      }));
      const svc = makeService({ repo, http });

      const result = await svc.validate('custom:ext');

      expect(http.get).toHaveBeenCalledWith(
        'https://ext.test/health',
        expect.anything(),
      );
      expect(result).toEqual({
        harnessId: 'custom:ext',
        reachable: true,
        capabilities: { toolModel: 'permission_callback' },
        credentialStatus: [],
      });
    });

    it('external-unreachable: reports reachable:false with no capabilities', async () => {
      const repo = makeFakeRepo({
        'custom:ext': {
          harnessId: 'custom:ext',
          transport: 'external',
          imageRef: '',
          endpointConfig: { baseUrl: 'https://down.test' },
        },
      });
      const http = makeHttpClient(async () => ({
        ok: false,
        status: 0,
        json: async () => null,
      }));
      const svc = makeService({ repo, http });

      const result = await svc.validate('custom:ext');

      expect(result.reachable).toBe(false);
      expect(result.capabilities).toBeUndefined();
      expect(result.credentialStatus).toEqual([]);
    });

    it('kernel-bound: resolveAll yields a credential -> bound credentialStatus, reachable:true', async () => {
      const repo = makeFakeRepo({
        'custom:k': {
          harnessId: 'custom:k',
          transport: 'kernel',
          imageRef: 'acme/k:1',
        },
      });
      const resolver = makeResolver(async () => ({
        anthropic: {
          key: 'anthropic',
          authType: 'api_key',
          auth: { type: 'api_key', apiKey: 'x' },
        },
      }));
      const svc = makeService({ repo, resolver });

      const result = await svc.validate('custom:k', 'scope-1');

      expect(resolver.resolveAll).toHaveBeenCalledWith({
        harnessId: 'custom:k',
        scopeNodeId: 'scope-1',
      });
      expect(result.reachable).toBe(true);
      expect(result.credentialStatus).toEqual([
        { key: 'anthropic', bound: true, authType: 'api_key' },
      ]);
    });

    it('kernel-missing: resolveAll yields nothing -> reachable:false, no bound credentials', async () => {
      const repo = makeFakeRepo({
        'custom:k': {
          harnessId: 'custom:k',
          transport: 'kernel',
          imageRef: 'acme/k:1',
        },
      });
      const resolver = makeResolver(async () => ({}));
      const svc = makeService({ repo, resolver });

      const result = await svc.validate('custom:k');

      expect(result.reachable).toBe(false);
      expect(result.credentialStatus).toEqual([]);
    });

    it('empty-image: kernel harness with empty imageRef is not reachable even when bound', async () => {
      const repo = makeFakeRepo({
        'custom:k': {
          harnessId: 'custom:k',
          transport: 'kernel',
          imageRef: '',
        },
      });
      const resolver = makeResolver(async () => ({
        anthropic: {
          key: 'anthropic',
          authType: 'api_key',
          auth: { type: 'api_key', apiKey: 'x' },
        },
      }));
      const svc = makeService({ repo, resolver });

      const result = await svc.validate('custom:k');

      expect(result.reachable).toBe(false);
      expect(result.credentialStatus).toEqual([
        { key: 'anthropic', bound: true, authType: 'api_key' },
      ]);
    });
  });
});
