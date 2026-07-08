import type { RuntimeToolchainConfig, CacheMountSpec } from '@nexus/core';

function firstNonEmpty<T>(lists: Array<T[] | undefined>): T[] {
  for (const list of lists) if (list && list.length > 0) return list;
  return [];
}

function unionCaches(
  layers: Array<RuntimeToolchainConfig | undefined>,
): CacheMountSpec[] {
  const byId = new Map<string, CacheMountSpec>();
  for (const layer of layers)
    for (const cache of layer?.caches ?? [])
      if (!byId.has(cache.id)) byId.set(cache.id, cache);
  return [...byId.values()];
}

export function mergeToolchainLayers(
  layers: Array<RuntimeToolchainConfig | undefined>,
): RuntimeToolchainConfig {
  return {
    toolchains: firstNonEmpty(layers.map((l) => l?.toolchains)),
    aptPackages: firstNonEmpty(layers.map((l) => l?.aptPackages)),
    caches: unionCaches(layers),
    disableCaches: [...new Set(layers.flatMap((l) => l?.disableCaches ?? []))],
  };
}
