import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessContributions,
  type HarnessHookAsset,
  type HarnessExtensionAsset,
  type HarnessPlugin,
  type HarnessSettingsContribution,
  type ResolvedMcpServerDescriptor,
} from '@nexus/core';
import type {
  ContributionOrigin,
  ContributionSource,
  ContributionLedger,
  ResolveContributionsParams,
} from './harness-contribution-resolver.types';
import {
  hydrateAssetReferences,
  type AssetRefs,
} from './harness-asset-hydration';
import {
  resolveMcpServerRefs,
  type McpSecretResolver,
} from './harness-mcp-ref-resolution';

// Re-export the public surface so consumers import from one module.
export type {
  ContributionOrigin,
  ContributionSource,
  ContributionLedger,
  ResolveContributionsParams,
} from './harness-contribution-resolver.types';

const CONTRIBUTION_DROPPED_EVENT = 'harness_contribution_dropped' as const;

type ContributionType = 'hook' | 'extension' | 'settings' | 'plugin';

function emitDropped(
  ledger: ContributionLedger | undefined,
  harnessId: string,
  type: ContributionType,
  reason: string,
  origin?: ContributionOrigin,
): void {
  ledger?.emitBestEffort({
    type: CONTRIBUTION_DROPPED_EVENT,
    harnessId,
    contributionType: type,
    reason,
    ...(origin !== undefined ? { origin } : {}),
  });
}

function hookKey(h: HarnessHookAsset): string {
  const cmd = 'command' in h ? h.command : `script:${h.script.language}`;
  return `${h.event}::${h.matcher ?? ''}::${cmd}`;
}

function mergeSettings(
  lower: HarnessSettingsContribution,
  higher: HarnessSettingsContribution,
): HarnessSettingsContribution {
  const merged: HarnessSettingsContribution = {};

  const mergedEnv = { ...(lower.env ?? {}), ...(higher.env ?? {}) };
  if (Object.keys(mergedEnv).length > 0) {
    merged.env = mergedEnv;
  }

  const mergedPermissions = higher.permissions ?? lower.permissions;
  if (mergedPermissions) {
    merged.permissions = {
      allow: higher.permissions?.allow ?? lower.permissions?.allow,
      deny: higher.permissions?.deny ?? lower.permissions?.deny,
    };
  }

  const mergedOutputStyle = higher.outputStyle ?? lower.outputStyle;
  if (mergedOutputStyle !== undefined) {
    merged.outputStyle = mergedOutputStyle;
  }

  return merged;
}

function mergeHooks(
  hooks: HarnessHookAsset[],
  seenHooks: Set<string>,
  supportedEvents: Set<string>,
  source: ContributionSource,
  params: ResolveContributionsParams,
): void {
  const { capabilities: caps, harnessId, ledger } = params;

  for (const hook of source.contributions.hooks ?? []) {
    if (!caps.supportsHooks) {
      emitDropped(
        ledger,
        harnessId,
        'hook',
        'hooks_unsupported',
        source.origin,
      );
      continue;
    }
    if (!supportedEvents.has(hook.event)) {
      emitDropped(
        ledger,
        harnessId,
        'hook',
        `event_unsupported:${hook.event}`,
        source.origin,
      );
      continue;
    }
    const key = hookKey(hook);
    if (seenHooks.has(key)) continue;
    seenHooks.add(key);
    hooks.push(hook);
  }
}

function mergeExtensions(
  extensions: HarnessExtensionAsset[],
  seenExt: Set<string>,
  source: ContributionSource,
  params: ResolveContributionsParams,
): void {
  const { capabilities: caps, harnessId, ledger } = params;

  for (const ext of source.contributions.extensions ?? []) {
    if (!caps.supportsExtensions) {
      emitDropped(
        ledger,
        harnessId,
        'extension',
        'extensions_unsupported',
        source.origin,
      );
      continue;
    }
    if (seenExt.has(ext.id)) continue;
    seenExt.add(ext.id);
    extensions.push(ext);
  }
}

function applySettings(
  currentSettings: HarnessSettingsContribution,
  source: ContributionSource,
  params: ResolveContributionsParams,
): HarnessSettingsContribution {
  const { capabilities: caps, harnessId, ledger } = params;
  const c = source.contributions;

  if (!c.settings || Object.keys(c.settings).length === 0) {
    return currentSettings;
  }
  if (!caps.supportsSettings) {
    emitDropped(
      ledger,
      harnessId,
      'settings',
      'settings_unsupported',
      source.origin,
    );
    return currentSettings;
  }
  return mergeSettings(currentSettings, c.settings);
}

/**
 * Merge author contributions by precedence (sources are highest-first), validate
 * each against the resolved harness's capabilities, and drop unsupported items
 * with best-effort ledger diagnostics — never a hard failure, never silent.
 *
 * Hooks/extensions concatenate (de-duplicated); settings deep-merge with higher
 * precedence winning per key.
 */
export function resolveHarnessContributions(
  params: ResolveContributionsParams,
): HarnessContributions {
  const hooks: HarnessHookAsset[] = [];
  const seenHooks = new Set<string>();
  const extensions: HarnessExtensionAsset[] = [];
  const seenExt = new Set<string>();
  let settings: HarnessSettingsContribution = {};
  const supportedEvents = new Set(
    params.capabilities.supportedHookEvents ?? [],
  );

  // Process low → high so higher precedence settings keys overwrite.
  const ordered = [...params.sources].reverse();

  for (const source of ordered) {
    mergeHooks(hooks, seenHooks, supportedEvents, source, params);
    mergeExtensions(extensions, seenExt, source, params);
    settings = applySettings(settings, source, params);
  }

  if (
    hooks.length === 0 &&
    extensions.length === 0 &&
    Object.keys(settings).length === 0
  ) {
    return EMPTY_HARNESS_CONTRIBUTIONS;
  }
  return { hooks, extensions, plugins: [], settings };
}

/**
 * Collect all asset refs from sources, maintaining precedence order (step first).
 *
 * Deduplication happens inside `hydrateAssetReferences`; here we just flatten
 * in precedence order so the first occurrence wins.
 */
function collectAssetRefs(sources: ContributionSource[]): AssetRefs {
  const pluginRefs: string[] = [];
  const extensionRefs: string[] = [];
  for (const source of sources) {
    if (source.pluginRefs) pluginRefs.push(...source.pluginRefs);
    if (source.extensionRefs) extensionRefs.push(...source.extensionRefs);
  }
  return { pluginRefs, extensionRefs };
}

/**
 * Resolves all contributions — synchronous hook/extension/settings merge via
 * `resolveHarnessContributions`, then async asset-ref hydration (plugins and
 * extension-package assets) if an `assetRepository` is provided, followed by
 * MCP server ref resolution for any `mcpServerRefs` declared by the hydrated
 * plugins if an `mcpServerRepository` is provided.
 *
 * When there are no asset refs and no repos, the result is identical to
 * `resolveHarnessContributions`.
 */
export async function resolveHarnessContributionsWithAssets(
  params: ResolveContributionsParams,
): Promise<HarnessContributions> {
  const base = resolveHarnessContributions(params);

  // Phase 1: asset-ref hydration (plugins + extension packages).
  const { plugins: mergedPlugins, extensions: mergedExtensions } =
    await hydrateAssets(base, params);

  // Phase 2: resolve mcpServerRefs from all merged plugins.
  const resolvedMcpServers = await resolveMcpRefsFromPlugins(
    mergedPlugins,
    params.mcpServerRepository,
    params.mcpSecretResolver,
    params.ledger,
    params.harnessId,
  );

  const isEmpty =
    base.hooks.length === 0 &&
    mergedExtensions.length === 0 &&
    mergedPlugins.length === 0 &&
    Object.keys(base.settings).length === 0 &&
    resolvedMcpServers.length === 0;

  if (isEmpty) {
    return EMPTY_HARNESS_CONTRIBUTIONS;
  }

  return {
    hooks: base.hooks,
    extensions: mergedExtensions,
    plugins: mergedPlugins,
    settings: base.settings,
    ...(resolvedMcpServers.length > 0 ? { resolvedMcpServers } : {}),
  };
}

/**
 * Hydrate asset refs from sources into plugins and extensions.
 * Returns the base lists unchanged when no `assetRepository` is provided
 * or when there are no refs to hydrate.
 */
async function hydrateAssets(
  base: HarnessContributions,
  params: ResolveContributionsParams,
): Promise<{ plugins: HarnessPlugin[]; extensions: HarnessExtensionAsset[] }> {
  const plugins: HarnessPlugin[] = base.plugins ?? [];
  const extensions: HarnessExtensionAsset[] = base.extensions ?? [];

  if (!params.assetRepository) return { plugins, extensions };

  const refs = collectAssetRefs(params.sources);
  const hasRefs =
    (refs.pluginRefs?.length ?? 0) > 0 || (refs.extensionRefs?.length ?? 0) > 0;

  if (!hasRefs) return { plugins, extensions };

  const { plugins: hydratedPlugins, extensions: hydratedExts } =
    await hydrateAssetReferences(
      refs,
      params.assetRepository,
      params.capabilities,
      params.ledger,
    );

  return {
    plugins: [...plugins, ...hydratedPlugins],
    extensions: [...extensions, ...hydratedExts],
  };
}

/**
 * Collect and resolve all `mcpServerRefs` from the given plugins. Drops
 * unknown IDs with a best-effort `harness_contribution_dropped` diagnostic.
 * Returns an empty array when no plugins carry refs or no repository is
 * provided.
 */
async function resolveMcpRefsFromPlugins(
  plugins: HarnessPlugin[],
  mcpServerRepository: ResolveContributionsParams['mcpServerRepository'],
  mcpSecretResolver: McpSecretResolver | undefined,
  ledger: ContributionLedger | undefined,
  harnessId: string,
): Promise<ResolvedMcpServerDescriptor[]> {
  if (!mcpServerRepository || plugins.length === 0) return [];

  // Collect all refs across all plugins (de-duplication happens inside resolveMcpServerRefs).
  const allRefs: string[] = [];
  for (const plugin of plugins) {
    const refs = plugin.capabilities?.mcpServerRefs;
    if (refs && refs.length > 0) {
      allRefs.push(...refs);
    }
  }

  if (allRefs.length === 0) return [];

  // Fall back to a no-op resolver when none is provided (e.g. in tests that
  // don't configure secrets); plaintext values are still surfaced.
  const resolver: McpSecretResolver = mcpSecretResolver ?? {
    resolveMap: ({ plaintext }) => Promise.resolve(plaintext ?? null),
  };

  const { resolved, droppedIds } = await resolveMcpServerRefs(
    allRefs,
    mcpServerRepository,
    resolver,
  );

  for (const droppedId of droppedIds) {
    emitDropped(
      ledger,
      harnessId,
      'plugin',
      `mcp_server_ref_not_found:${droppedId}`,
    );
  }

  return resolved;
}
