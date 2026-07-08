import type { RuntimeToolchainConfig } from '@nexus/core';
import type { CachePreset } from './cache-volume-presets.types';

const hasTool = (config: RuntimeToolchainConfig, tool: string): boolean =>
  config.toolchains.some((t) => t.tool === tool);

export const CACHE_PRESETS: CachePreset[] = [
  {
    id: 'mise',
    containerPath: '/root/.cache/mise',
    env: { MISE_CACHE_DIR: '/root/.cache/mise' },
    enabledFor: () => true,
  },
  {
    id: 'apt',
    containerPath: '/var/cache/apt/archives',
    enabledFor: () => true,
  },
  {
    id: 'npm',
    containerPath: '/root/.npm',
    env: { npm_config_cache: '/root/.npm' },
    enabledFor: (c) => hasTool(c, 'node'),
  },
  {
    id: 'pip',
    containerPath: '/root/.cache/pip',
    env: { PIP_CACHE_DIR: '/root/.cache/pip' },
    enabledFor: (c) => hasTool(c, 'python'),
  },
  {
    id: 'go',
    containerPath: '/root/go/pkg/mod',
    env: { GOMODCACHE: '/root/go/pkg/mod', GOCACHE: '/root/.cache/go-build' },
    enabledFor: (c) => hasTool(c, 'go'),
  },
  {
    id: 'cargo',
    containerPath: '/root/.cargo/registry',
    env: { CARGO_HOME: '/root/.cargo' },
    enabledFor: (c) => hasTool(c, 'rust'),
  },
  {
    id: 'maven',
    containerPath: '/root/.m2',
    enabledFor: (c) => hasTool(c, 'java'),
  },
];

export const CACHE_VOLUME_PREFIX = 'nexus-cache-';
