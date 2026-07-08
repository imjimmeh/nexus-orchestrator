import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { HarnessAssetService } from './harness-asset.service';
import { computeAssetChecksum } from '@nexus/core';
import { entityToPlugin, entityToExtension } from '../harness-asset-hydration';
import { stageExtensionAssets } from '@nexus/harness-engine-pi';
import type { HarnessAssetEntity } from './harness-asset.entity';
import type { HarnessAssetSource } from '@nexus/core';
import type { HarnessAssetRepository } from './harness-asset.repository';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function buildEntity(
  overrides: Partial<HarnessAssetEntity> = {},
): HarnessAssetEntity {
  const source: HarnessAssetSource = { kind: 'authored' };
  return {
    id: 'asset-uuid-1',
    kind: 'hook_script',
    name: 'my-hook',
    version: '1.0.0',
    source,
    checksum: 'sha256:abc',
    bundle: '{}',
    scopeNodeId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(
  createReturn: HarnessAssetEntity = buildEntity(),
  findByScopeReturn: HarnessAssetEntity[] = [],
): Pick<HarnessAssetRepository, 'create' | 'findByScope'> {
  return {
    create: vi.fn(async () => createReturn),
    findByScope: vi.fn(async () => findByScopeReturn),
  };
}

function makeService(
  repo: Pick<HarnessAssetRepository, 'create' | 'findByScope'> = makeRepo(),
): HarnessAssetService {
  return new HarnessAssetService(repo as HarnessAssetRepository);
}

// ---------------------------------------------------------------------------
// Valid hook_script payload
// ---------------------------------------------------------------------------

const VALID_HOOK_PAYLOAD = {
  event: 'session_start' as const,
  script: { language: 'bash' as const, source: 'echo hello' },
};

const HOOK_BUNDLE = JSON.stringify(VALID_HOOK_PAYLOAD);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessAssetService', () => {
  describe('createAsset — hook_script', () => {
    it('validates, checksums, and persists a valid hook_script asset', async () => {
      const expectedChecksum = computeAssetChecksum(HOOK_BUNDLE);
      const entity = buildEntity({
        kind: 'hook_script',
        name: 'my-hook',
        version: '1.0.0',
        bundle: HOOK_BUNDLE,
        checksum: expectedChecksum,
      });
      const repo = makeRepo(entity);
      const svc = makeService(repo);

      const result = await svc.createAsset({
        kind: 'hook_script',
        name: 'my-hook',
        version: '1.0.0',
        source: { kind: 'authored' },
        payload: VALID_HOOK_PAYLOAD,
        scopeNodeId: null,
      });

      expect(repo.create).toHaveBeenCalledOnce();
      const createArg = vi.mocked(repo.create).mock.calls[0]?.[0];
      expect(createArg).toMatchObject({
        kind: 'hook_script',
        name: 'my-hook',
        version: '1.0.0',
        source: { kind: 'authored' },
        checksum: expectedChecksum,
        bundle: HOOK_BUNDLE,
        scopeNodeId: null,
      });
      expect(result).toBe(entity);
    });

    it('checksum equals computeAssetChecksum(bundle)', async () => {
      const repo = makeRepo();
      const svc = makeService(repo);

      await svc.createAsset({
        kind: 'hook_script',
        name: 'test',
        version: '0.1.0',
        source: { kind: 'authored' },
        payload: VALID_HOOK_PAYLOAD,
        scopeNodeId: null,
      });

      const createArg = vi.mocked(repo.create).mock.calls[0]?.[0];
      const bundle = createArg?.bundle ?? '';
      expect(createArg?.checksum).toBe(computeAssetChecksum(bundle));
    });
  });

  describe('createAsset — validation rejection', () => {
    it('rejects an invalid hook_script payload without persisting', async () => {
      const repo = makeRepo();
      const svc = makeService(repo);

      await expect(
        svc.createAsset({
          kind: 'hook_script',
          name: 'bad-hook',
          version: '1.0.0',
          source: { kind: 'authored' },
          // Missing required `event` field — invalid
          payload: { script: { language: 'bash', source: 'x' } } as never,
          scopeNodeId: null,
        }),
      ).rejects.toThrow(/invalid/i);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a hook_script with both script and command fields', async () => {
      const repo = makeRepo();
      const svc = makeService(repo);

      await expect(
        svc.createAsset({
          kind: 'hook_script',
          name: 'bad-hook',
          version: '1.0.0',
          source: { kind: 'authored' },
          payload: {
            event: 'session_start',
            script: { language: 'bash', source: 'x' },
            command: 'also-this',
          } as never,
          scopeNodeId: null,
        }),
      ).rejects.toThrow(/invalid/i);

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('createAsset — plugin bundle contract', () => {
    it('persists a plugin bundle with a top-level capabilities key', async () => {
      const capabilities = {
        hooks: [],
        slashCommands: ['summarize'],
      };
      const manifest = {
        capabilities,
        description: 'A test plugin',
        extra: 'data',
      };
      const bundle = JSON.stringify(manifest);
      const entity = buildEntity({
        id: 'plugin-uuid-1',
        kind: 'plugin',
        name: 'my-plugin',
        version: '2.0.0',
        bundle,
        checksum: computeAssetChecksum(bundle),
      });
      const repo = makeRepo(entity);
      const svc = makeService(repo);

      const result = await svc.createAsset({
        kind: 'plugin',
        name: 'my-plugin',
        version: '2.0.0',
        source: { kind: 'authored' },
        payload: manifest,
        scopeNodeId: null,
      });

      const createArg = vi.mocked(repo.create).mock.calls[0]?.[0];
      const parsedBundle: Record<string, unknown> = JSON.parse(
        createArg?.bundle ?? '{}',
      );

      // The hydration projection reads manifest['capabilities'] — it MUST be present.
      expect(parsedBundle['capabilities']).toEqual(capabilities);
      expect(result).toBe(entity);
    });

    it('plugin bundle round-trips through hydration projection (genuine entityToPlugin)', async () => {
      const capabilities = {
        slashCommands: ['explain'],
        mcpServerRefs: ['mcp-server-1'],
      };
      const manifest = { capabilities, pluginVersion: '3' };
      const repo = makeRepo();
      const svc = makeService(repo);

      await svc.createAsset({
        kind: 'plugin',
        name: 'roundtrip-plugin',
        version: '3.0.0',
        source: { kind: 'authored' },
        payload: manifest,
        scopeNodeId: null,
      });

      // Read the row the SERVICE actually wrote, not a fixture we built.
      const written = vi.mocked(repo.create).mock.calls[0]?.[0];
      expect(written).toBeDefined();

      // Construct a minimal entity-shaped object from what the service persisted.
      const entityShape: HarnessAssetEntity = {
        id: 'roundtrip-id',
        kind: 'plugin',
        name: written.name,
        version: written.version,
        source: written.source,
        checksum: written.checksum,
        bundle: written.bundle,
        scopeNodeId: written.scopeNodeId,
        createdAt: new Date(),
      };

      // Feed it through the ACTUAL hydration projection — proves that the
      // service's serialization is the true inverse of entityToPlugin's read.
      const hydrated = entityToPlugin(entityShape);
      expect(hydrated).toBeDefined();
      expect(hydrated!.capabilities).toEqual(capabilities);
    });
  });

  describe('createAsset — extension', () => {
    it('persists an extension asset with runtime, entry, and moduleSource in bundle', async () => {
      const extensionPayload = {
        runtime: 'ts-module' as const,
        entry: 'src/index.ts',
        moduleSource: 'export default function run() {}',
      };
      const bundle = JSON.stringify(extensionPayload);
      const entity = buildEntity({
        id: 'ext-uuid-1',
        kind: 'extension',
        name: 'my-ext',
        version: '1.0.0',
        bundle,
        checksum: computeAssetChecksum(bundle),
      });
      const repo = makeRepo(entity);
      const svc = makeService(repo);

      await svc.createAsset({
        kind: 'extension',
        name: 'my-ext',
        version: '1.0.0',
        source: { kind: 'authored' },
        payload: extensionPayload,
        scopeNodeId: null,
      });

      const createArg = vi.mocked(repo.create).mock.calls[0]?.[0];
      const parsedBundle: Record<string, unknown> = JSON.parse(
        createArg?.bundle ?? '{}',
      );
      // entityToExtension reads parsed['runtime'], parsed['entry'], and
      // parsed['moduleSource'] — all three must be in the persisted bundle.
      expect(parsedBundle['runtime']).toBe('ts-module');
      expect(parsedBundle['entry']).toBe('src/index.ts');
      expect(parsedBundle['moduleSource']).toBe(
        'export default function run() {}',
      );
    });

    it('rejects a ts-module extension with no moduleSource', async () => {
      const repo = makeRepo();
      const svc = makeService(repo);

      await expect(
        svc.createAsset({
          kind: 'extension',
          name: 'bad-ext',
          version: '1.0.0',
          source: { kind: 'authored' },
          payload: {
            runtime: 'ts-module' as const,
            entry: 'src/index.ts',
            // No moduleSource — ts-module with no code is invalid.
          },
          scopeNodeId: null,
        }),
      ).rejects.toThrow(/invalid/i);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accepts a package-runtime extension without moduleSource', async () => {
      const extensionPayload = {
        runtime: 'package' as const,
        entry: 'dist/index.js',
      };
      const bundle = JSON.stringify(extensionPayload);
      const entity = buildEntity({
        id: 'pkg-ext-uuid-1',
        kind: 'extension',
        name: 'my-pkg-ext',
        version: '1.0.0',
        bundle,
        checksum: computeAssetChecksum(bundle),
      });
      const repo = makeRepo(entity);
      const svc = makeService(repo);

      // Should NOT throw — package-runtime does not require moduleSource.
      await expect(
        svc.createAsset({
          kind: 'extension',
          name: 'my-pkg-ext',
          version: '1.0.0',
          source: { kind: 'authored' },
          payload: extensionPayload,
          scopeNodeId: null,
        }),
      ).resolves.toBeDefined();

      expect(repo.create).toHaveBeenCalledOnce();
    });

    it('extension bundle round-trips through hydration projection (genuine entityToExtension)', async () => {
      const extensionPayload = {
        runtime: 'ts-module' as const,
        entry: 'dist/main.js',
        moduleSource: 'export const main = true;',
        extraMeta: 'preserved',
      };
      const repo = makeRepo();
      const svc = makeService(repo);

      await svc.createAsset({
        kind: 'extension',
        name: 'roundtrip-ext',
        version: '1.1.0',
        source: { kind: 'authored' },
        payload: extensionPayload,
        scopeNodeId: null,
      });

      // Read the row the SERVICE actually wrote, not a fixture we built.
      const written = vi.mocked(repo.create).mock.calls[0]?.[0];
      expect(written).toBeDefined();

      // Construct a minimal entity-shaped object from what the service persisted.
      const entityShape: HarnessAssetEntity = {
        id: 'roundtrip-ext-id',
        kind: 'extension',
        name: written.name,
        version: written.version,
        source: written.source,
        checksum: written.checksum,
        bundle: written.bundle,
        scopeNodeId: written.scopeNodeId,
        createdAt: new Date(),
      };

      // Feed it through the ACTUAL hydration projection — proves that the
      // service's serialization is the true inverse of entityToExtension's read.
      const hydrated = entityToExtension(entityShape);
      expect(hydrated).toBeDefined();
      expect(hydrated!.runtime).toBe('ts-module');
      expect(hydrated!.entry).toBe('dist/main.js');
      // moduleSource must survive the round-trip so the PI engine can stage it.
      expect(hydrated!.moduleSource).toBe('export const main = true;');
    });
  });

  describe('createAsset — extension end-to-end staging (author→hydrate→stage)', () => {
    it('authored moduleSource survives author→entityToExtension→stageExtensionAssets and is the file content on disk', async () => {
      // 1. Author: build the extension bundle via the service (TDD Red→Green).
      const MODULE_SOURCE = 'export function greet() { return "hello"; }';
      const extensionPayload = {
        runtime: 'ts-module' as const,
        entry: 'src/greet.ts',
        moduleSource: MODULE_SOURCE,
      };
      const repo = makeRepo();
      const svc = makeService(repo);

      await svc.createAsset({
        kind: 'extension',
        name: 'e2e-greet-ext',
        version: '1.0.0',
        source: { kind: 'authored' },
        payload: extensionPayload,
        scopeNodeId: null,
      });

      // 2. Capture the row the service persisted (the bundle JSON string).
      const written = vi.mocked(repo.create).mock.calls[0]?.[0];
      expect(written).toBeDefined();

      // 3. Hydrate: reconstruct a HarnessAssetEntity and run it through
      //    entityToExtension — this is the path taken by hydrateAssetReferences
      //    before session creation.
      const entityShape: HarnessAssetEntity = {
        id: 'e2e-ext-id',
        kind: 'extension',
        name: written.name,
        version: written.version,
        source: written.source,
        checksum: written.checksum,
        bundle: written.bundle,
        scopeNodeId: written.scopeNodeId,
        createdAt: new Date(),
      };
      const hydrated = entityToExtension(entityShape);
      expect(hydrated).toBeDefined();
      expect(hydrated!.moduleSource).toBe(MODULE_SOURCE);

      // 4. Stage: pass the hydrated extension to stageExtensionAssets — this is
      //    the path taken by the PI harness engine before loading extensions.
      const extensionsPath = fs.mkdtempSync(
        path.join(os.tmpdir(), 'e2e-ext-staging-'),
      );
      try {
        const stagedPaths = stageExtensionAssets(extensionsPath, [hydrated!]);

        // 5. Assert the staged file contents are byte-identical to the authored
        //    source — proving the author→hydrate→stage pipeline is end-to-end wired.
        expect(stagedPaths).toHaveLength(1);
        const stagedContent = fs.readFileSync(stagedPaths[0], 'utf-8');
        expect(stagedContent).toBe(MODULE_SOURCE);
      } finally {
        fs.rmSync(extensionsPath, { recursive: true, force: true });
      }
    });
  });

  describe('listAssets', () => {
    it('returns scope-filtered rows from the repository', async () => {
      const rows = [
        buildEntity({ id: 'a1', scopeNodeId: 'scope-x' }),
        buildEntity({ id: 'a2', scopeNodeId: 'scope-x' }),
      ];
      const repo = makeRepo(buildEntity(), rows);
      const svc = makeService(repo);

      const result = await svc.listAssets('scope-x');

      expect(repo.findByScope).toHaveBeenCalledWith('scope-x');
      expect(result).toBe(rows);
    });

    it('returns platform-global rows when no scopeNodeId given', async () => {
      const rows = [buildEntity({ scopeNodeId: null })];
      const repo = makeRepo(buildEntity(), rows);
      const svc = makeService(repo);

      const result = await svc.listAssets(null);

      expect(repo.findByScope).toHaveBeenCalledWith(null);
      expect(result).toBe(rows);
    });
  });
});
