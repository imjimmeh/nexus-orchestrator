import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { AgentProfile } from './agent-profile.entity';
import type { FallbackChainEntry, RuntimeToolchainConfig } from '@nexus/core';

describe('AgentProfile entity', () => {
  it('has composite unique index on (name, scope_node_id)', () => {
    const storage = getMetadataArgsStorage();
    const indices = storage.indices.filter((i) => i.target === AgentProfile);
    const compositeUnique = indices.find(
      (i) =>
        i.unique &&
        Array.isArray(i.columns) &&
        i.columns.includes('name') &&
        i.columns.includes('scope_node_id'),
    );
    expect(compositeUnique).toBeDefined();
  });

  it('does NOT have a single-column unique on name', () => {
    const storage = getMetadataArgsStorage();
    const cols = storage.columns.filter((c) => c.target === AgentProfile);
    const nameCol = cols.find((c) => c.propertyName === 'name');
    expect((nameCol?.options as any)?.unique).toBeFalsy();
  });

  it('has base_profile_id column', () => {
    const storage = getMetadataArgsStorage();
    const cols = storage.columns.filter((c) => c.target === AgentProfile);
    const col = cols.find((c) => c.propertyName === 'base_profile_id');
    expect(col).toBeDefined();
  });
});

describe('AgentProfile.fallback_chain', () => {
  it('accepts an ordered list of provider/model entries', () => {
    const profile = new AgentProfile();
    const chain: FallbackChainEntry[] = [
      { provider_name: 'anthropic-a', model_name: 'claude-opus-4-8' },
      { provider_name: 'openai-b', model_name: 'gpt-4' },
    ];
    profile.fallback_chain = chain;
    expect(profile.fallback_chain).toHaveLength(2);
    expect(profile.fallback_chain[0].provider_name).toBe('anthropic-a');
  });
});

describe('AgentProfile.runtime_toolchains', () => {
  it('accepts a resolved runtime toolchain config', () => {
    const profile = new AgentProfile();
    const config: RuntimeToolchainConfig = {
      toolchains: [{ tool: 'python', version: '3.12' }],
      aptPackages: ['libpq-dev'],
      caches: [{ id: 'pip', path: '/root/.cache/pip' }],
    };
    profile.runtime_toolchains = config;
    expect(profile.runtime_toolchains.toolchains).toHaveLength(1);
    expect(profile.runtime_toolchains.toolchains[0].tool).toBe('python');
  });

  it('defaults to undefined when not set', () => {
    const profile = new AgentProfile();
    expect(profile.runtime_toolchains).toBeUndefined();
  });
});
