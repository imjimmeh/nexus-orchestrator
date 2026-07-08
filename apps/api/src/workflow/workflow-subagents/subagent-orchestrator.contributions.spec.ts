import { describe, it, expect } from 'vitest';
import { attachResolvedContributions } from '../workflow-step-execution/step-agent-step-executor.contributions.helpers';
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

describe('subagent contributions attachment', () => {
  it('attaches resolved contributions to the subagent config', () => {
    const out = attachResolvedContributions(baseConfig, {
      harnessId: 'claude-code',
      capabilities: caps,
      sources: [
        {
          origin: 'profile',
          contributions: { settings: { outputStyle: 'concise' } },
        },
      ],
    });
    expect(out.contributions?.settings.outputStyle).toBe('concise');
  });

  it('omits contributions for an unsupported harness', () => {
    const out = attachResolvedContributions(
      { ...baseConfig, harnessId: 'pi' },
      {
        harnessId: 'pi',
        capabilities: { ...caps, supportsSettings: false },
        sources: [
          {
            origin: 'profile',
            contributions: { settings: { outputStyle: 'concise' } },
          },
        ],
      },
    );
    expect(out.contributions).toBeUndefined();
  });
});
