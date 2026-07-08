import type { HarnessPlugin, HarnessExtensionAsset } from '@nexus/core';

/** A record of an asset reference that was dropped and why. */
export interface DroppedAsset {
  id: string;
  kind: 'plugin' | 'extension';
  reason: string;
}

/** Input references gathered from all contribution surfaces. */
export interface AssetRefs {
  /** Ordered plugin asset ids (highest-precedence first: step → profile → skill). */
  pluginRefs?: string[];
  /** Ordered extension asset ids (highest-precedence first). */
  extensionRefs?: string[];
}

/** Output of a successful hydration pass. */
export interface HydratedAssets {
  plugins: HarnessPlugin[];
  extensions: HarnessExtensionAsset[];
  dropped: DroppedAsset[];
}
