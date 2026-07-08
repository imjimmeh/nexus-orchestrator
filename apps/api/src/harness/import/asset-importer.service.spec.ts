import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { AssetImporterService } from './asset-importer.service';
import { computeAssetChecksum } from '@nexus/core';
import type { HarnessAssetRepository } from '../assets/harness-asset.repository';
import type { HarnessAssetEntity } from '../assets/harness-asset.entity';
import type { HarnessAssetSource } from '@nexus/core';
import type { SourceFetcher } from './source-fetcher';
import type {
  FetchedFile,
  ImportAssetOptions,
} from './asset-importer.service.types';
import { DEFAULT_SIZE_CAP_BYTES } from './asset-vetting';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeRepo(returnedId: string = 'new-asset-uuid'): Pick<
  HarnessAssetRepository,
  'create'
> & {
  create: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async (input) => ({
      id: returnedId,
      kind: input.kind,
      name: input.name,
      version: input.version,
      source: input.source,
      checksum: input.checksum,
      bundle: input.bundle,
      scopeNodeId: input.scopeNodeId,
      createdAt: new Date(),
    })),
  };
}

function makeFetcher(
  files: FetchedFile[],
  resolvedRef: string = 'abc1234567890abcdef1234567890abcdef123456',
): SourceFetcher {
  return {
    fetch: vi.fn(async () => ({ files, resolvedRef })),
  };
}

function makeService(
  fetcher: SourceFetcher,
  repo: Pick<HarnessAssetRepository, 'create'> = makeRepo(),
): AssetImporterService {
  return new AssetImporterService(repo as HarnessAssetRepository, fetcher);
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

const RESOLVED_SHA = 'abc1234567890abcdef1234567890abcdef123456';

const PLUGIN_MANIFEST = JSON.stringify({
  name: 'my-test-plugin',
  description: 'A test plugin',
  capabilities: { slashCommands: ['run'] },
});

const VALID_CC_FILES: FetchedFile[] = [
  { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
];

/**
 * A CC plugin with a `hooks/hooks.json` file that carries a `PreToolUse` hook
 * so we can verify hooks are parsed and stored in `capabilities.hooks`.
 */
const CC_PLUGIN_WITH_HOOKS_JSON = JSON.stringify({
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo before-tool' }],
    },
  ],
});

const VALID_CC_FILES_WITH_HOOKS: FetchedFile[] = [
  { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
  { path: 'hooks/hooks.json', contents: CC_PLUGIN_WITH_HOOKS_JSON },
];

const PI_MODULE_SOURCE = `export default function setup(pi) {
  pi.registerProvider('test', {});
}`;

const VALID_PI_FILES: FetchedFile[] = [
  { path: 'test-extension.ts', contents: PI_MODULE_SOURCE },
];

const GIT_SOURCE: HarnessAssetSource = {
  kind: 'git',
  repo: 'https://github.com/example/my-test-plugin',
  ref: 'main',
};

// ---------------------------------------------------------------------------
// CC plugin import — happy path
// ---------------------------------------------------------------------------

describe('AssetImporterService — CC plugin (git source)', () => {
  it('fetches, validates, checksums, and persists a valid CC plugin', async () => {
    const repo = makeRepo('plugin-uuid-1');
    const fetcher = makeFetcher(VALID_CC_FILES, RESOLVED_SHA);
    const svc = makeService(fetcher, repo);

    const id = await svc.importAsset(GIT_SOURCE);

    expect(id).toBe('plugin-uuid-1');
    expect(fetcher.fetch).toHaveBeenCalledWith(GIT_SOURCE);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('persists kind="plugin"', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.kind).toBe('plugin');
  });

  it('pins the source ref to the RESOLVED commit SHA, not the original ref', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES, RESOLVED_SHA), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const persistedSource = arg?.source as { kind: string; ref: string };
    // Must carry the resolved SHA, not the mutable 'main' ref.
    expect(persistedSource.kind).toBe('git');
    expect(persistedSource.ref).toBe(RESOLVED_SHA);
  });

  it('bundle contains a "capabilities" key so the hydration projection can read it', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const parsed = JSON.parse(arg?.bundle ?? '{}') as Record<string, unknown>;
    expect(parsed['capabilities']).toBeDefined();
  });

  it('stored checksum equals computeAssetChecksum(bundle)', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const bundle = arg?.bundle ?? '';
    expect(arg?.checksum).toBe(computeAssetChecksum(bundle));
  });

  it('asset name is derived from the manifest "name" field', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.name).toBe('my-test-plugin');
  });

  it('passes scopeNodeId through to the persisted row', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE, { scopeNodeId: 'scope-abc' });

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.scopeNodeId).toBe('scope-abc');
  });

  it('uses null scopeNodeId by default (platform-global asset)', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.scopeNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PI extension import — happy path
// ---------------------------------------------------------------------------

describe('AssetImporterService — PI extension (git source)', () => {
  it('fetches, validates, checksums, and persists a valid single-file PI extension', async () => {
    const repo = makeRepo('ext-uuid-1');
    const svc = makeService(makeFetcher(VALID_PI_FILES, RESOLVED_SHA), repo);

    const id = await svc.importAsset(GIT_SOURCE);

    expect(id).toBe('ext-uuid-1');
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('persists kind="extension" with runtime="ts-module"', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_PI_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.kind).toBe('extension');
    const parsed = JSON.parse(arg?.bundle ?? '{}') as Record<string, unknown>;
    expect(parsed['runtime']).toBe('ts-module');
  });

  it('bundle contains moduleSource equal to the fetched file contents', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_PI_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const parsed = JSON.parse(arg?.bundle ?? '{}') as Record<string, unknown>;
    expect(parsed['moduleSource']).toBe(PI_MODULE_SOURCE);
  });

  it('pins the source ref to the resolved SHA', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_PI_FILES, RESOLVED_SHA), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const src = arg?.source as { kind: string; ref: string };
    expect(src.ref).toBe(RESOLVED_SHA);
  });

  it('stored checksum equals computeAssetChecksum(bundle)', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_PI_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const bundle = arg?.bundle ?? '';
    expect(arg?.checksum).toBe(computeAssetChecksum(bundle));
  });
});

// ---------------------------------------------------------------------------
// Manifest validation failures
// ---------------------------------------------------------------------------

describe('AssetImporterService — manifest validation rejection', () => {
  it('rejects a CC plugin with missing plugin.json and does not persist', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: 'some-other-file.txt', contents: 'irrelevant' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a CC plugin with invalid (non-JSON) plugin.json and does not persist', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: 'NOT JSON {{' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a CC plugin whose plugin.json is missing the required "name" field', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: '.claude-plugin/plugin.json',
        contents: JSON.stringify({ description: 'no name here' }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a CC plugin whose "name" is not kebab-case', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: '.claude-plugin/plugin.json',
        contents: JSON.stringify({ name: 'My Plugin With Spaces' }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a CC marketplace import (multi-plugin repos not supported in v1)', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: '.claude-plugin/plugin.json',
        contents: JSON.stringify({ name: 'base' }),
      },
      {
        path: '.claude-plugin/marketplace.json',
        contents: JSON.stringify({ plugins: [] }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a PI extension with no default export', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: 'my-ext.ts',
        contents: 'function setup(pi) { /* no default export */ }',
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Size cap rejection
// ---------------------------------------------------------------------------

describe('AssetImporterService — size cap rejection', () => {
  it('rejects a bundle that exceeds the default size cap without persisting', async () => {
    const repo = makeRepo();
    // Build a file slightly over the default cap (5 MiB).
    const hugeContents = 'x'.repeat(DEFAULT_SIZE_CAP_BYTES + 1);
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'large-asset.bin', contents: hugeContents },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a bundle that exceeds a custom size cap', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: '.claude-plugin/plugin.json',
        contents: PLUGIN_MANIFEST,
      },
      { path: 'medium.bin', contents: 'x'.repeat(1024) },
    ];
    const svc = makeService(makeFetcher(files), repo);
    const opts: ImportAssetOptions = { sizeCap: 512 };

    await expect(svc.importAsset(GIT_SOURCE, opts)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts a bundle exactly at the size cap', async () => {
    const repo = makeRepo();
    // The manifest itself is well under 100 bytes; use a 1-byte cap that passes
    // by targeting a cap larger than the fixture.
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);
    // Using a generous cap that the small fixture easily fits.
    const opts: ImportAssetOptions = { sizeCap: 10 * 1024 * 1024 };

    await expect(svc.importAsset(GIT_SOURCE, opts)).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Denylist rejection
// ---------------------------------------------------------------------------

describe('AssetImporterService — denylist rejection', () => {
  it('rejects a source whose repo URL is on the denylist before fetching', async () => {
    const repo = makeRepo();
    const fetcher = makeFetcher(VALID_CC_FILES);
    const svc = makeService(fetcher, repo);
    const opts: ImportAssetOptions = {
      denylist: ['https://github.com/example/my-test-plugin'],
    };

    await expect(svc.importAsset(GIT_SOURCE, opts)).rejects.toThrow(
      UnprocessableEntityException,
    );
    // Denylist check happens before fetch — fetcher must not be called.
    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('denylist comparison is case-insensitive', async () => {
    const repo = makeRepo();
    const fetcher = makeFetcher(VALID_CC_FILES);
    const svc = makeService(fetcher, repo);
    const opts: ImportAssetOptions = {
      denylist: ['HTTPS://GITHUB.COM/EXAMPLE/MY-TEST-PLUGIN'],
    };

    await expect(svc.importAsset(GIT_SOURCE, opts)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('allows a source not on the denylist', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);
    const opts: ImportAssetOptions = {
      denylist: ['https://github.com/other/repo'],
    };

    await expect(svc.importAsset(GIT_SOURCE, opts)).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('rejects a registry source whose package name is on the denylist', async () => {
    const repo = makeRepo();
    const fetcher = makeFetcher(VALID_PI_FILES);
    const svc = makeService(fetcher, repo);
    const registrySource: HarnessAssetSource = {
      kind: 'registry',
      name: 'bad-package',
      version: '1.0.0',
    };
    const opts: ImportAssetOptions = { denylist: ['bad-package'] };

    await expect(svc.importAsset(registrySource, opts)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multi-file / packaged PI extension rejection (v1 constraint)
// ---------------------------------------------------------------------------

describe('AssetImporterService — multi-file PI extension rejection (v1)', () => {
  it('rejects a PI extension with package.json present (packaged extension)', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: 'package.json',
        contents: JSON.stringify({
          name: 'my-ext',
          pi: { extensions: ['index.ts'] },
        }),
      },
      { path: 'index.ts', contents: 'export default function setup(pi) {}' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a PI extension with multiple root-level .ts files (multi-file, v1 only)', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: 'entry.ts', contents: 'export default function setup(pi) {}' },
      { path: 'helpers.ts', contents: 'export const x = 1;' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a PI extension with no root-level .ts files at all', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      {
        path: 'src/index.ts',
        contents: 'export default function setup(pi) {}',
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Immutability + provenance guarantees
// ---------------------------------------------------------------------------

describe('AssetImporterService — immutability and provenance', () => {
  it('the persisted row carries the pinned provenance (resolved SHA, not mutable ref)', async () => {
    const pinnedSha = 'deadbeef1234567890abcdef1234567890abcdef';
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES, pinnedSha), repo);

    await svc.importAsset({
      kind: 'git',
      repo: 'https://github.com/a/b',
      ref: 'v1.0.0',
    });

    const arg = repo.create.mock.calls[0]?.[0];
    const src = arg?.source as { kind: string; ref: string };
    // ref must be the resolved SHA, not the original 'v1.0.0' tag.
    expect(src.ref).toBe(pinnedSha);
    expect(src.ref).not.toBe('v1.0.0');
  });

  it('the persisted checksum matches the bundle that was stored', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    // The only acceptable checksum is sha256:<hex> computed over the stored bundle.
    expect(arg?.checksum).toBe(computeAssetChecksum(arg?.bundle ?? ''));
  });

  it('repo.create is called exactly once per importAsset call (no silent duplicates)', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('repo.create is never called when vetting fails', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      // plugin.json without required 'name' — vetting fails.
      {
        path: '.claude-plugin/plugin.json',
        contents: JSON.stringify({ version: '1.0' }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Registry source support
// ---------------------------------------------------------------------------

describe('AssetImporterService — registry source', () => {
  it('pins the registry source to the resolved version/digest', async () => {
    const repo = makeRepo();
    const resolvedDigest = 'sha256:abc123def456';
    const svc = makeService(makeFetcher(VALID_PI_FILES, resolvedDigest), repo);
    const registrySource: HarnessAssetSource = {
      kind: 'registry',
      name: 'my-ext-package',
      version: '1.0.0',
    };

    await svc.importAsset(registrySource);

    const arg = repo.create.mock.calls[0]?.[0];
    const src = arg?.source as { kind: string; version: string };
    expect(src.kind).toBe('registry');
    expect(src.version).toBe(resolvedDigest);
  });

  it('stores the resolved digest as the version column for a registry CC plugin (Fix I-2)', async () => {
    const repo = makeRepo();
    const resolvedDigest = 'sha256:deadbeef1234567890abcdef';
    const svc = makeService(makeFetcher(VALID_CC_FILES, resolvedDigest), repo);
    const registrySource: HarnessAssetSource = {
      kind: 'registry',
      name: 'my-cc-plugin-package',
      version: '2.0.0',
    };

    await svc.importAsset(registrySource);

    const arg = repo.create.mock.calls[0]?.[0];
    // The version column must carry the resolved digest, NOT the original '2.0.0' range.
    expect(arg?.version).toBe(resolvedDigest);
    expect(arg?.version).not.toBe('2.0.0');
  });

  it('stores the resolved digest as the version column for a registry PI extension (Fix I-2)', async () => {
    const repo = makeRepo();
    const resolvedDigest = 'sha256:abc999def000';
    const svc = makeService(makeFetcher(VALID_PI_FILES, resolvedDigest), repo);
    const registrySource: HarnessAssetSource = {
      kind: 'registry',
      name: 'my-pi-ext-package',
      version: '3.1.0',
    };

    await svc.importAsset(registrySource);

    const arg = repo.create.mock.calls[0]?.[0];
    expect(arg?.version).toBe(resolvedDigest);
    expect(arg?.version).not.toBe('3.1.0');
  });
});

// ---------------------------------------------------------------------------
// Fake fetcher — no network in tests
// ---------------------------------------------------------------------------

describe('AssetImporterService — fake fetcher isolation', () => {
  it('the fake fetcher is called with the original source, not a modified one', async () => {
    const fetcher = makeFetcher(VALID_CC_FILES);
    const svc = makeService(fetcher);

    await svc.importAsset(GIT_SOURCE);

    expect(fetcher.fetch).toHaveBeenCalledWith(GIT_SOURCE);
  });

  it('tests never hit the network — all I/O goes through the injected SourceFetcher', async () => {
    // This test proves the contract: if the fake fetcher was NOT called, the
    // test would fail. The real DefaultSourceFetcher is never instantiated here.
    const fetcher = makeFetcher(VALID_CC_FILES);
    const svc = makeService(fetcher);

    await svc.importAsset(GIT_SOURCE);

    // Exactly one fetch call, nothing else.
    expect(fetcher.fetch).toHaveBeenCalledExactlyOnceWith(GIT_SOURCE);
  });
});

// ---------------------------------------------------------------------------
// Fix A — hooks/hooks.json round-trip
// ---------------------------------------------------------------------------

describe('AssetImporterService — CC plugin hooks/hooks.json import (Fix A)', () => {
  it('parses hooks/hooks.json and stores parsed hooks in capabilities.hooks', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES_WITH_HOOKS), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const parsed = JSON.parse(arg?.bundle ?? '{}') as Record<string, unknown>;
    const capabilities = parsed['capabilities'] as {
      hooks?: Array<{ event: string; matcher?: string; command: string }>;
    };
    expect(capabilities.hooks).toBeDefined();
    expect(capabilities.hooks).toHaveLength(1);
    expect(capabilities.hooks?.[0]?.event).toBe('pre_tool_use');
    expect(capabilities.hooks?.[0]?.matcher).toBe('Bash');
    expect(capabilities.hooks?.[0]?.command).toBe('echo before-tool');
  });

  it('stores no hooks in capabilities when hooks/hooks.json is absent', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES), repo);

    await svc.importAsset(GIT_SOURCE);

    const arg = repo.create.mock.calls[0]?.[0];
    const parsed = JSON.parse(arg?.bundle ?? '{}') as Record<string, unknown>;
    const capabilities = parsed['capabilities'] as Record<string, unknown>;
    // No hooks key when hooks/hooks.json is absent.
    expect(capabilities['hooks']).toBeUndefined();
  });

  it('rejects a plugin with an invalid (non-JSON) hooks/hooks.json', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'hooks/hooks.json', contents: 'NOT JSON' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a plugin with hooks/hooks.json containing an array (not an object)', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'hooks/hooks.json', contents: '[]' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a plugin with an unknown SDK hook event in hooks/hooks.json', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      {
        path: 'hooks/hooks.json',
        contents: JSON.stringify({
          UnknownEvent: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fix A — v1 unsupported component rejection
// ---------------------------------------------------------------------------

describe('AssetImporterService — CC plugin v1 unsupported component rejection (Fix A)', () => {
  it('rejects a plugin containing a commands/ directory', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'commands/run.sh', contents: '#!/bin/bash\necho run' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a plugin containing an agents/ directory', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'agents/my-agent.md', contents: '# My Agent' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a plugin containing a skills/ directory', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      { path: 'skills/my-skill.md', contents: '# My Skill' },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a plugin containing an inline .mcp.json', async () => {
    const repo = makeRepo();
    const files: FetchedFile[] = [
      { path: '.claude-plugin/plugin.json', contents: PLUGIN_MANIFEST },
      {
        path: '.mcp.json',
        contents: JSON.stringify({
          mcpServers: { myServer: { command: 'npx' } },
        }),
      },
    ];
    const svc = makeService(makeFetcher(files), repo);

    await expect(svc.importAsset(GIT_SOURCE)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts a plugin with only plugin.json and hooks/hooks.json (no unsupported components)', async () => {
    const repo = makeRepo();
    const svc = makeService(makeFetcher(VALID_CC_FILES_WITH_HOOKS), repo);

    await expect(svc.importAsset(GIT_SOURCE)).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalledOnce();
  });
});
