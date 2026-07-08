import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_CODE_CAPABILITIES,
  PI_CAPABILITIES,
  type HarnessId,
} from '@nexus/core';
import { resolveRunnerHarness } from './harness-runtime-selection';

const passthroughProvider = (provider: string) => ({
  provider,
  auth: { type: 'api_key' as const, apiKey: 'key' },
  baseUrl: undefined,
});

describe('resolveRunnerHarness', () => {
  it('uses the step override ahead of the project default', async () => {
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: CLAUDE_CODE_CAPABILITIES })),
    };

    const result = await resolveRunnerHarness({
      registry,
      stepOverride: 'claude-code',
      projectDefault: 'pi',
      providerConfig: passthroughProvider('anthropic-claude-code'),
      resolvedModel: 'claude-sonnet-4-6',
      aiConfig: { resolveRunnerProviderConfig: vi.fn() },
    });

    expect(result.harnessId).toBe('claude-code');
    expect(result.providerConfig.provider).toBe('anthropic-claude-code');
  });

  it('uses the project (scoped) default when no override is present', async () => {
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: CLAUDE_CODE_CAPABILITIES })),
    };

    const result = await resolveRunnerHarness({
      registry,
      projectDefault: 'claude-code',
      providerConfig: passthroughProvider('anthropic-claude-code'),
      resolvedModel: 'claude-sonnet-4-6',
      aiConfig: { resolveRunnerProviderConfig: vi.fn() },
    });

    expect(result.harnessId).toBe('claude-code');
  });

  it('falls back to the platform harness (pi) when nothing is configured', async () => {
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: PI_CAPABILITIES })),
    };

    const result = await resolveRunnerHarness({
      registry,
      providerConfig: passthroughProvider('openai'),
      resolvedModel: 'gpt-4o',
      aiConfig: { resolveRunnerProviderConfig: vi.fn() },
    });

    expect(result.harnessId).toBe('pi');
  });

  it('falls back to pi and re-resolves the provider when the chosen provider is incompatible', async () => {
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: CLAUDE_CODE_CAPABILITIES })),
    };
    const resolveRunnerProviderConfig = vi.fn(
      async ({ providerName }: { providerName?: string }) =>
        passthroughProvider(providerName ?? 'anthropic'),
    );
    const ledger = { emitBestEffort: vi.fn(async () => undefined) };

    const result = await resolveRunnerHarness({
      registry,
      projectDefault: 'claude-code',
      providerConfig: passthroughProvider('openai'),
      resolvedModel: 'gpt-4o',
      aiConfig: { resolveRunnerProviderConfig },
      scopeNodeId: 'scope-a',
      ledger,
    });

    expect(result.harnessId).toBe('pi');
    expect(result.providerConfig.provider).toBe('anthropic-claude-code');
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'harness.selection.fallback' }),
    );
  });

  it('keeps the harness when the registry exposes no capability resolver', async () => {
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
    };

    const result = await resolveRunnerHarness({
      registry,
      projectDefault: 'claude-code',
      providerConfig: passthroughProvider('anything'),
      resolvedModel: 'm',
      aiConfig: { resolveRunnerProviderConfig: vi.fn() },
    });

    expect(result.harnessId).toBe('claude-code');
  });
});
