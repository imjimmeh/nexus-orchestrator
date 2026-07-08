import {
  resolveHarnessId,
  requiredCapabilitiesForStep,
  validateOrFallback,
  validateProviderCompatibility,
} from './harness-selection';
import { PI_CAPABILITIES, CLAUDE_CODE_CAPABILITIES } from '@nexus/core';

describe('resolveHarnessId precedence', () => {
  it('prefers the step override', () => {
    expect(
      resolveHarnessId({
        stepOverride: 'claude-code',
        profileDefault: 'pi',
        projectDefault: 'pi',
        platformDefault: 'pi',
      }),
    ).toBe('claude-code');
  });
  it('falls back through profile, project, platform', () => {
    expect(
      resolveHarnessId({
        profileDefault: 'claude-code',
        platformDefault: 'pi',
      }),
    ).toBe('claude-code');
    expect(resolveHarnessId({ platformDefault: 'pi' })).toBe('pi');
  });
  it('returns the platform default when nothing else is set', () => {
    expect(resolveHarnessId({ platformDefault: 'pi' })).toBe('pi');
  });
});

describe('requiredCapabilitiesForStep', () => {
  it('requires branching when the step sets resumeNodeId', () => {
    expect(
      requiredCapabilitiesForStep({ resumeNodeId: 'n1' }).supportsBranching,
    ).toBe(true);
  });
  it('does not require branching when no resumeNodeId', () => {
    expect(requiredCapabilitiesForStep({}).supportsBranching).toBeUndefined();
  });
});

describe('validateOrFallback', () => {
  it('falls back when the selected harness lacks a required capability', () => {
    const r = validateOrFallback(
      { supportsBranching: false } as any,
      { supportsBranching: true },
      'claude-code',
      'pi',
    );
    expect(r.harnessId).toBe('pi');
    expect(r.fallbackReason).toMatch(/branching/i);
  });

  it('keeps selection when capabilities are satisfied', () => {
    const r = validateOrFallback(
      PI_CAPABILITIES,
      { supportsBranching: true },
      'pi',
      'pi',
    );
    expect(r.harnessId).toBe('pi');
    expect(r.fallbackReason).toBeUndefined();
  });

  it('keeps selection when no capabilities required', () => {
    const r = validateOrFallback(
      { supportsBranching: false } as any,
      {},
      'claude-code',
      'pi',
    );
    expect(r.harnessId).toBe('claude-code');
    expect(r.fallbackReason).toBeUndefined();
  });
});

describe('validateProviderCompatibility', () => {
  it('keeps the selection when the provider is compatible', () => {
    const r = validateProviderCompatibility(
      CLAUDE_CODE_CAPABILITIES,
      'anthropic-claude-code',
      'claude-code',
      'pi',
    );
    expect(r.harnessId).toBe('claude-code');
    expect(r.fallbackReason).toBeUndefined();
  });

  it('falls back when the provider is incompatible with the harness', () => {
    const r = validateProviderCompatibility(
      CLAUDE_CODE_CAPABILITIES,
      'openai',
      'claude-code',
      'pi',
    );
    expect(r.harnessId).toBe('pi');
    expect(r.providerName).toBe('anthropic-claude-code'); // harness defaultProviderId
    expect(r.fallbackReason).toMatch(/provider/i);
  });

  it('imposes no constraint when compatibleProviderIds is unset (pi)', () => {
    const r = validateProviderCompatibility(
      PI_CAPABILITIES,
      'openai',
      'pi',
      'pi',
    );
    expect(r.harnessId).toBe('pi');
    expect(r.fallbackReason).toBeUndefined();
  });
});
