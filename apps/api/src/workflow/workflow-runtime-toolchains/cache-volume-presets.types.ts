import type { RuntimeToolchainConfig } from '@nexus/core';

/** A built-in package/OS cache preset, gated by which toolchains are present. */
export interface CachePreset {
  id: string;
  containerPath: string;
  env?: Record<string, string>;
  enabledFor: (config: RuntimeToolchainConfig) => boolean;
}
