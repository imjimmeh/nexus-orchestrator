import { createHash } from 'node:crypto';
import type { RuntimeToolchainConfig } from '@nexus/core';

export const COMPOSITE_TAG_PREFIX = 'nexus-rt';
const HASH_LEN = 12;

function canonical(config: RuntimeToolchainConfig): string {
  const toolchains = [...config.toolchains]
    .map((t) => `${t.tool}@${t.version}`)
    .sort();
  const apt = [...(config.aptPackages ?? [])].sort();
  return JSON.stringify({ toolchains, apt });
}

export function computeCompositeImageTag(params: {
  harnessId: string;
  baseImageId: string;
  config: RuntimeToolchainConfig;
}): string {
  const hash = createHash('sha256')
    .update(params.baseImageId)
    .update(canonical(params.config))
    .digest('hex')
    .slice(0, HASH_LEN);
  return `${COMPOSITE_TAG_PREFIX}/${params.harnessId}:${hash}`;
}

export function isNodeOnly(config: RuntimeToolchainConfig): boolean {
  if ((config.aptPackages ?? []).length > 0) return false;
  return config.toolchains.every((t) => t.tool === 'node');
}
