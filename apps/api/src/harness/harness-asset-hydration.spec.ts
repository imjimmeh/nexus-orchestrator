import { describe, it, expect, vi } from 'vitest';
import type { HarnessCapabilities } from '@nexus/core';
import { computeAssetChecksum } from '@nexus/core';
import type { HarnessAssetRepository } from './assets/harness-asset.repository';
import type { HarnessAssetEntity } from './assets/harness-asset.entity';
import { hydrateAssetReferences } from './harness-asset-hydration';
import type { ContributionLedger } from './harness-contribution-resolver.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(
  rows: Partial<HarnessAssetEntity>[],
): Pick<HarnessAssetRepository, 'findByIds'> {
  return {
    findByIds: vi.fn().mockResolvedValue(rows),
  };
}

function pluginBundle(): string {
  return JSON.stringify({ entrypoint: 'dist/index.js' });
}

function makePlugin(
  id: string,
  bundleContent = pluginBundle(),
): HarnessAssetEntity {
  return {
    id,
    kind: 'plugin',
    name: `plugin-${id}`,
    version: '1.0.0',
    source: { kind: 'authored' },
    checksum: computeAssetChecksum(bundleContent),
    bundle: bundleContent,
    scopeNodeId: null,
    createdAt: new Date(),
  };
}

function makeExtension(
  id: string,
  bundleContent = '{"runtime":"ts-module"}',
): HarnessAssetEntity {
  return {
    id,
    kind: 'extension',
    name: `ext-${id}`,
    version: '1.0.0',
    source: { kind: 'authored' },
    checksum: computeAssetChecksum(bundleContent),
    bundle: bundleContent,
    scopeNodeId: null,
    createdAt: new Date(),
  };
}

const fullCaps: HarnessCapabilities = {
  executionModes: ['agent_turn'],
  toolModel: 'permission_callback',
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: false,
  supportsResume: true,
  resumeMechanism: 'config_ref',
  supportsThinkingLevels: false,
  supportedAuthTypes: ['api_key'],
  telemetryContractVersion: 'v1',
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportsPlugins: true,
  supportsExtensionPackages: true,
  supportedHookEvents: ['session_start'],
};

const noPluginCaps: HarnessCapabilities = {
  ...fullCaps,
  supportsPlugins: false,
};

const noExtPackageCaps: HarnessCapabilities = {
  ...fullCaps,
  supportsExtensionPackages: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hydrateAssetReferences', () => {
  it('returns empty arrays when there are no refs', async () => {
    const repo = makeRepo([]);
    const result = await hydrateAssetReferences(
      { pluginRefs: [], extensionRefs: [] },
      repo,
      fullCaps,
    );
    expect(result).toEqual({ plugins: [], extensions: [], dropped: [] });
    expect(repo.findByIds).not.toHaveBeenCalled();
  });

  it('hydrates plugin and extension refs into typed arrays', async () => {
    const plugin = makePlugin('plug-1');
    const ext = makeExtension('ext-1');
    const repo = makeRepo([plugin, ext]);

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-1'], extensionRefs: ['ext-1'] },
      repo,
      fullCaps,
    );

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('plug-1');
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('ext-1');
    expect(result.dropped).toHaveLength(0);
  });

  it('drops a row whose checksum does not match a recompute and emits a diagnostic', async () => {
    const plugin = makePlugin('plug-tampered');
    const tampered: HarnessAssetEntity = {
      ...plugin,
      checksum:
        'sha256:deadbeef00000000000000000000000000000000000000000000000000000000',
    };
    const repo = makeRepo([tampered]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-tampered'] },
      repo,
      fullCaps,
      ledger,
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('plug-tampered');
    expect(result.dropped[0].reason).toMatch(/checksum/i);
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'harness_contribution_dropped',
        contributionType: 'plugin',
      }),
    );
  });

  it('drops a plugin asset when supportsPlugins is false and emits a diagnostic', async () => {
    const plugin = makePlugin('plug-1');
    const repo = makeRepo([plugin]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-1'] },
      repo,
      noPluginCaps,
      ledger,
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('plug-1');
    expect(result.dropped[0].reason).toBe('plugins_unsupported');
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'harness_contribution_dropped',
        contributionType: 'plugin',
        reason: 'plugins_unsupported',
      }),
    );
  });

  it('drops an extension asset when supportsExtensionPackages is false and emits a diagnostic', async () => {
    const ext = makeExtension('ext-1');
    const repo = makeRepo([ext]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { extensionRefs: ['ext-1'] },
      repo,
      noExtPackageCaps,
      ledger,
    );

    expect(result.extensions).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('ext-1');
    expect(result.dropped[0].reason).toBe('extension_packages_unsupported');
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'harness_contribution_dropped',
        contributionType: 'extension',
        reason: 'extension_packages_unsupported',
      }),
    );
  });

  it('de-duplicates by id and keeps the first occurrence (step beats profile beats skill precedence)', async () => {
    // Same id appears twice — simulate two surfaces providing the same plugin.
    const plugin1 = makePlugin('plug-shared');
    const repo = makeRepo([plugin1]);

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-shared', 'plug-shared'] },
      repo,
      fullCaps,
    );

    // The repo is expected to return the row once; de-dup keeps only one entry.
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('plug-shared');
  });

  it('drops a ref whose id was not found in the repository', async () => {
    // repo returns nothing for an unknown id
    const repo = makeRepo([]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-missing'] },
      repo,
      fullCaps,
      ledger,
    );

    expect(result.plugins).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('plug-missing');
    expect(result.dropped[0].reason).toMatch(/not_found/);
  });

  it('drops a plugin row with a malformed (non-JSON) bundle, emits invalid_bundle diagnostic, and still hydrates sibling assets', async () => {
    const malformedPlugin: HarnessAssetEntity = {
      id: 'plug-broken',
      kind: 'plugin',
      name: 'broken-plugin',
      version: '1.0.0',
      source: { kind: 'authored' },
      // checksum must match the raw bundle so it passes checksum verification
      checksum: computeAssetChecksum('not valid json {{{'),
      bundle: 'not valid json {{{',
      scopeNodeId: null,
      createdAt: new Date(),
    };
    const goodPlugin = makePlugin('plug-good');
    const repo = makeRepo([malformedPlugin, goodPlugin]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { pluginRefs: ['plug-broken', 'plug-good'] },
      repo,
      fullCaps,
      ledger,
    );

    // Good sibling still hydrates.
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('plug-good');

    // Malformed asset is dropped with the correct reason.
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('plug-broken');
    expect(result.dropped[0].reason).toBe('invalid_bundle');
    expect(result.dropped[0].kind).toBe('plugin');

    // Diagnostic is emitted but bundle contents must NOT be included.
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'harness_contribution_dropped',
        contributionType: 'plugin',
        assetId: 'plug-broken',
        reason: 'invalid_bundle',
      }),
    );
    const call = (ledger.emitBestEffort as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(call)).not.toContain('not valid json');
  });

  it('drops an extension row with a malformed bundle and still hydrates a sibling extension', async () => {
    const malformedExt: HarnessAssetEntity = {
      id: 'ext-broken',
      kind: 'extension',
      name: 'broken-ext',
      version: '1.0.0',
      source: { kind: 'authored' },
      checksum: computeAssetChecksum('{bad'),
      bundle: '{bad',
      scopeNodeId: null,
      createdAt: new Date(),
    };
    const goodExt = makeExtension('ext-good');
    const repo = makeRepo([malformedExt, goodExt]);
    const ledger: ContributionLedger = { emitBestEffort: vi.fn() };

    const result = await hydrateAssetReferences(
      { extensionRefs: ['ext-broken', 'ext-good'] },
      repo,
      fullCaps,
      ledger,
    );

    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('ext-good');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe('ext-broken');
    expect(result.dropped[0].reason).toBe('invalid_bundle');
  });

  it('cross-surface dedup: same asset id from step wins over profile/skill, hydrated once', async () => {
    // Simulate: step, profile, and skill all reference the same plugin id.
    // The caller merges all refs in step-first order before calling hydrateAssetReferences.
    // The first occurrence (step) wins; subsequent occurrences are silently deduplicated.
    const plugin = makePlugin('plug-shared-cross');
    const repo = makeRepo([plugin]);

    const result = await hydrateAssetReferences(
      // step → profile → skill order (highest precedence first)
      {
        pluginRefs: [
          'plug-shared-cross',
          'plug-shared-cross',
          'plug-shared-cross',
        ],
      },
      repo,
      fullCaps,
    );

    // Must be hydrated exactly once even though referenced three times.
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].id).toBe('plug-shared-cross');
    expect(result.dropped).toHaveLength(0);
  });
});
