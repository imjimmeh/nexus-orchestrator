import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessCapabilities,
  type HarnessExtensionAsset,
} from '@nexus/core';
import {
  resolveHarnessContributions,
  type ContributionSource,
} from './harness-contribution-resolver';

const fullCaps: HarnessCapabilities = {
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
  supportedHookEvents: ['session_start', 'pre_tool_use'],
};

const noHookCaps: HarnessCapabilities = {
  ...fullCaps,
  supportsHooks: false,
  supportedHookEvents: [],
};

const piExtAsset: HarnessExtensionAsset = {
  id: 'ext-001',
  name: 'my-extension',
  runtime: 'ts-module',
  entry: './dist/index.js',
  source: { kind: 'authored' },
  checksum: 'sha256:abc123',
};

describe('resolveHarnessContributions', () => {
  it('merges hooks/extensions and lets higher precedence win settings keys', () => {
    const sources: ContributionSource[] = [
      {
        origin: 'step',
        contributions: { settings: { outputStyle: 'concise' } },
      },
      {
        origin: 'profile',
        contributions: {
          hooks: [{ event: 'session_start', command: 'echo profile' }],
          settings: { outputStyle: 'verbose', env: { A: '1' } },
        },
      },
      {
        origin: 'skill',
        contributions: {
          extensions: [piExtAsset],
        },
      },
    ];
    const out = resolveHarnessContributions({
      harnessId: 'claude-code',
      capabilities: fullCaps,
      sources,
    });
    expect(out.hooks).toHaveLength(1);
    expect(out.extensions).toHaveLength(1);
    expect(out.settings.outputStyle).toBe('concise'); // step beats profile
    expect(out.settings.env).toEqual({ A: '1' });
  });

  it('drops unsupported hook events with a ledger diagnostic', () => {
    const emitBestEffort = vi.fn();
    const out = resolveHarnessContributions({
      harnessId: 'claude-code',
      capabilities: fullCaps,
      sources: [
        {
          origin: 'profile',
          contributions: {
            hooks: [
              { event: 'session_start', command: 'ok' },
              { event: 'post_tool_use', command: 'dropped' }, // not in supportedHookEvents
            ],
          },
        },
      ],
      ledger: { emitBestEffort },
    });
    expect(out.hooks).toHaveLength(1);
    const hook = out.hooks[0];
    expect('command' in hook && hook.command).toBe('ok');
    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'harness_contribution_dropped' }),
    );
  });

  it('drops all hooks when the harness does not support hooks', () => {
    const emitBestEffort = vi.fn();
    const out = resolveHarnessContributions({
      harnessId: 'pi',
      capabilities: noHookCaps,
      sources: [
        {
          origin: 'profile',
          contributions: { hooks: [{ event: 'session_start', command: 'x' }] },
        },
      ],
      ledger: { emitBestEffort },
    });
    expect(out.hooks).toEqual([]);
    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'harness_contribution_dropped',
        reason: 'hooks_unsupported',
      }),
    );
  });

  it('returns the empty bundle for no sources', () => {
    const out = resolveHarnessContributions({
      harnessId: 'pi',
      capabilities: noHookCaps,
      sources: [],
    });
    expect(out).toEqual(EMPTY_HARNESS_CONTRIBUTIONS);
  });

  it('returns EMPTY_HARNESS_CONTRIBUTIONS when only source has settings with empty env', () => {
    // I1: mergeSettings must not emit env:{} when neither side has any env keys.
    const settingsCaps: HarnessCapabilities = { ...fullCaps };
    const sources: ContributionSource[] = [
      {
        origin: 'profile',
        contributions: { settings: { env: {} } },
      },
    ];
    const out = resolveHarnessContributions({
      harnessId: 'claude-code',
      capabilities: settingsCaps,
      sources,
    });
    expect(out).toEqual(EMPTY_HARNESS_CONTRIBUTIONS);
  });
});
