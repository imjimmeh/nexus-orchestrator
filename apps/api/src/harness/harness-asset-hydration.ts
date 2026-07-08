import type {
  HarnessCapabilities,
  HarnessPlugin,
  HarnessExtensionAsset,
} from '@nexus/core';
import { computeAssetChecksum } from '@nexus/core';
import type { HarnessAssetRepository } from './assets/harness-asset.repository';
import type { HarnessAssetEntity } from './assets/harness-asset.entity';
import type { ContributionLedger } from './harness-contribution-resolver.types';
import type {
  AssetRefs,
  DroppedAsset,
  HydratedAssets,
} from './harness-asset-hydration.types';

export type {
  AssetRefs,
  DroppedAsset,
  HydratedAssets,
} from './harness-asset-hydration.types';

const CONTRIBUTION_DROPPED_EVENT = 'harness_contribution_dropped' as const;

function emitDropped(
  ledger: ContributionLedger | undefined,
  id: string,
  kind: DroppedAsset['kind'],
  reason: string,
): void {
  ledger?.emitBestEffort({
    type: CONTRIBUTION_DROPPED_EVENT,
    contributionType: kind,
    assetId: id,
    reason,
  });
}

/**
 * Returns the parsed plugin, or `undefined` when the bundle is not valid JSON.
 * Never logs bundle contents — callers emit a drop diagnostic with only the id.
 */
export function entityToPlugin(
  entity: HarnessAssetEntity,
): HarnessPlugin | undefined {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(entity.bundle) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return {
    id: entity.id,
    name: entity.name,
    version: entity.version,
    source: entity.source,
    checksum: entity.checksum,
    bundle: entity.bundle,
    capabilities:
      (manifest['capabilities'] as HarnessPlugin['capabilities']) ?? {},
    manifest,
  };
}

/**
 * Returns the parsed extension asset, or `undefined` when the bundle is not valid JSON.
 * Never logs bundle contents — callers emit a drop diagnostic with only the id.
 *
 * The `moduleSource` field in the bundle (populated for `authored` ts-module
 * assets since EPIC-211) is forwarded verbatim onto the resolved asset so that
 * the harness engine can stage it as a `.ts` file at session creation time.
 */
export function entityToExtension(
  entity: HarnessAssetEntity,
): HarnessExtensionAsset | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(entity.bundle) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const moduleSource =
    typeof parsed['moduleSource'] === 'string' &&
    parsed['moduleSource'].length > 0
      ? parsed['moduleSource']
      : undefined;

  return {
    id: entity.id,
    name: entity.name,
    runtime:
      (parsed['runtime'] as HarnessExtensionAsset['runtime']) ?? 'ts-module',
    entry: (parsed['entry'] as string) ?? '',
    source: entity.source,
    checksum: entity.checksum,
    bundle: entity.bundle,
    ...(moduleSource !== undefined ? { moduleSource } : {}),
  };
}

/**
 * Load referenced harness asset rows, verify their checksums, capability-gate
 * each asset, and de-duplicate by id.
 *
 * Drops are always best-effort: a tampered or unsupported asset is skipped
 * with a `harness_contribution_dropped` diagnostic; it never throws.
 *
 * Empty refs ⇒ `{ plugins: [], extensions: [], dropped: [] }` with no DB call.
 */
export async function hydrateAssetReferences(
  refs: AssetRefs,
  repo: Pick<HarnessAssetRepository, 'findByIds'>,
  capabilities: HarnessCapabilities,
  ledger?: ContributionLedger,
): Promise<HydratedAssets> {
  const pluginRefs = refs.pluginRefs ?? [];
  const extensionRefs = refs.extensionRefs ?? [];
  const allIds = [...new Set([...pluginRefs, ...extensionRefs])];

  if (allIds.length === 0) {
    return { plugins: [], extensions: [], dropped: [] };
  }

  const rows = await repo.findByIds(allIds);
  const byId = new Map<string, HarnessAssetEntity>(rows.map((r) => [r.id, r]));

  const plugins: HarnessPlugin[] = [];
  const extensions: HarnessExtensionAsset[] = [];
  const dropped: DroppedAsset[] = [];

  // Asset ids are row UUIDs scoped to a single kind (one id = one row of one kind),
  // so sharing seenIds across both plugin and extension loops is safe.
  const seenIds = new Set<string>();

  function processRef(
    id: string,
    kind: DroppedAsset['kind'],
    onAccepted: (entity: HarnessAssetEntity) => void,
  ): void {
    // De-duplicate: first occurrence (highest precedence) wins.
    if (seenIds.has(id)) return;
    seenIds.add(id);

    const entity = byId.get(id);
    if (!entity) {
      const drop: DroppedAsset = { id, kind, reason: 'not_found' };
      dropped.push(drop);
      emitDropped(ledger, id, kind, 'not_found');
      return;
    }

    // Checksum verification — never stage tampered bytes.
    const recomputed = computeAssetChecksum(entity.bundle);
    if (entity.checksum !== recomputed) {
      const drop: DroppedAsset = { id, kind, reason: 'checksum_mismatch' };
      dropped.push(drop);
      emitDropped(ledger, id, kind, 'checksum_mismatch');
      return;
    }

    // Capability gate.
    if (kind === 'plugin' && !capabilities.supportsPlugins) {
      const drop: DroppedAsset = { id, kind, reason: 'plugins_unsupported' };
      dropped.push(drop);
      emitDropped(ledger, id, kind, 'plugins_unsupported');
      return;
    }
    if (kind === 'extension' && !capabilities.supportsExtensionPackages) {
      const drop: DroppedAsset = {
        id,
        kind,
        reason: 'extension_packages_unsupported',
      };
      dropped.push(drop);
      emitDropped(ledger, id, kind, 'extension_packages_unsupported');
      return;
    }

    onAccepted(entity);
  }

  for (const id of pluginRefs) {
    processRef(id, 'plugin', (entity) => {
      const plugin = entityToPlugin(entity);
      if (!plugin) {
        const drop: DroppedAsset = {
          id,
          kind: 'plugin',
          reason: 'invalid_bundle',
        };
        dropped.push(drop);
        emitDropped(ledger, id, 'plugin', 'invalid_bundle');
        return;
      }
      plugins.push(plugin);
    });
  }

  for (const id of extensionRefs) {
    processRef(id, 'extension', (entity) => {
      const extension = entityToExtension(entity);
      if (!extension) {
        const drop: DroppedAsset = {
          id,
          kind: 'extension',
          reason: 'invalid_bundle',
        };
        dropped.push(drop);
        emitDropped(ledger, id, 'extension', 'invalid_bundle');
        return;
      }
      extensions.push(extension);
    });
  }

  return { plugins, extensions, dropped };
}
