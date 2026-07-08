import type { RuntimeToolchainConfig } from '@nexus/core';
import { SUPPORTED_TOOLS } from '@nexus/core';

const VERSION_RE = /^[A-Za-z0-9._-]+$/;
const APT_RE = /^[a-z0-9][a-z0-9.+-]*$/;
const CACHE_ID_RE = /^[a-z0-9-]+$/;
const BLOCKED_MOUNTS = new Set(['/', '/app', '/workspace']);

function normalizePath(p: string): string {
  // Collapse multiple consecutive slashes
  p = p.replace(/\/+/g, '/');
  // Remove trailing slashes (but preserve root)
  if (p !== '/' && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  // Remove /./ segments: /. -> / and /./x -> /x
  p = p.replace(/\/\.(?=\/|$)/g, '');
  if (p === '') p = '/';
  return p;
}

export class ToolchainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolchainValidationError';
  }
}

export function validateRuntimeToolchainConfig(
  config: RuntimeToolchainConfig,
): void {
  for (const { tool, version } of config.toolchains) {
    if (!SUPPORTED_TOOLS.includes(tool as (typeof SUPPORTED_TOOLS)[number]))
      throw new ToolchainValidationError(`Unsupported toolchain tool: ${tool}`);
    if (!VERSION_RE.test(version))
      throw new ToolchainValidationError(
        `Invalid version for ${tool}: ${version}`,
      );
  }
  for (const pkg of config.aptPackages ?? [])
    if (!APT_RE.test(pkg))
      throw new ToolchainValidationError(`Invalid apt package: ${pkg}`);
  for (const cache of config.caches ?? []) {
    if (!CACHE_ID_RE.test(cache.id))
      throw new ToolchainValidationError(`Invalid cache id: ${cache.id}`);
    if (!cache.path.startsWith('/') || cache.path.includes('..'))
      throw new ToolchainValidationError(`Invalid cache path: ${cache.path}`);
    const normalizedPath = normalizePath(cache.path);
    if (BLOCKED_MOUNTS.has(normalizedPath))
      throw new ToolchainValidationError(
        `Cache path not allowed: ${cache.path}`,
      );
  }
}
