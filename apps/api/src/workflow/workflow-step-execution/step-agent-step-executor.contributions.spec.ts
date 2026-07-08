import { describe, it, expect } from 'vitest';
import { attachResolvedContributions } from './step-agent-step-executor.contributions.helpers';
import type { HarnessCapabilities, HarnessRuntimeConfig } from '@nexus/core';

const caps: HarnessCapabilities = {
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
  supportedHookEvents: ['session_start'],
};

const baseConfig = {
  harnessId: 'claude-code',
  model: {
    provider: 'anthropic',
    model: 'm',
    auth: { type: 'api_key', apiKey: 'k' },
  },
  prompt: { systemPrompt: 's' },
} as HarnessRuntimeConfig;

describe('attachResolvedContributions', () => {
  it('adds a contributions key when sources resolve non-empty', () => {
    const out = attachResolvedContributions(baseConfig, {
      harnessId: 'claude-code',
      capabilities: caps,
      sources: [
        {
          origin: 'profile',
          contributions: {
            hooks: [{ event: 'session_start', command: 'x' }],
          },
        },
      ],
    });
    const firstHook = out.contributions?.hooks?.[0];
    expect(
      firstHook && 'command' in firstHook ? firstHook.command : undefined,
    ).toBe('x');
  });

  it('omits contributions when nothing resolves', () => {
    const out = attachResolvedContributions(
      { ...baseConfig, harnessId: 'pi' },
      {
        harnessId: 'pi',
        capabilities: {
          ...caps,
          supportsHooks: false,
          supportedHookEvents: [],
        },
        sources: [
          {
            origin: 'profile',
            contributions: {
              hooks: [{ event: 'session_start', command: 'x' }],
            },
          },
        ],
      },
    );
    expect(out.contributions).toBeUndefined();
  });
});
