import { describe, expect, it } from 'vitest';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { RuntimeFeedbackPolicyService } from './runtime-feedback-policy.service';

const NOW = new Date('2026-05-17T00:00:00.000Z');

function buildSignal(
  overrides: Partial<RuntimeFeedbackSignal> = {},
): RuntimeFeedbackSignal {
  return {
    signal_type: 'tool_contract_repair',
    source_module: 'tool-runtime',
    scope: { scope_type: 'workflow_run', scope_id: 'run-1' },
    evidence: [{ kind: 'event_ledger', id: 'event-1', summary: 'Evidence.' }],
    examples: [{ summary: 'Safe example.', redacted: true }],
    confidence: 0.9,
    severity: 'medium',
    dedupe_fingerprint: 'feedback-fingerprint-1',
    occurred_at: NOW.toISOString(),
    ...overrides,
  };
}

describe('RuntimeFeedbackPolicyService', () => {
  const service = new RuntimeFeedbackPolicyService();

  it('skips low confidence signals with confidence_below_threshold', () => {
    const decision = service.evaluate({
      signal: buildSignal({ confidence: 0.74 }),
      occurrenceCount: 3,
      existingCandidateId: null,
      cooldownUntil: null,
      now: NOW,
    });

    expect(decision).toEqual({
      promote: false,
      skippedReason: 'confidence_below_threshold',
      cooldownUntil: null,
      resetWindow: false,
    });
  });

  it('skips below minimum occurrence count with frequency_below_threshold', () => {
    const decision = service.evaluate({
      signal: buildSignal({ severity: 'medium' }),
      occurrenceCount: 2,
      existingCandidateId: null,
      cooldownUntil: null,
      now: NOW,
    });

    expect(decision).toEqual({
      promote: false,
      skippedReason: 'frequency_below_threshold',
      cooldownUntil: null,
      resetWindow: false,
    });
  });

  it('promotes critical severity before minimum occurrence count', () => {
    const decision = service.evaluate({
      signal: buildSignal({ severity: 'critical' }),
      occurrenceCount: 1,
      existingCandidateId: null,
      cooldownUntil: null,
      now: NOW,
    });

    expect(decision).toEqual({
      promote: true,
      skippedReason: null,
      cooldownUntil: new Date('2026-05-24T00:00:00.000Z'),
      resetWindow: false,
    });
  });

  it('blocks promotion while cooldown is active', () => {
    const decision = service.evaluate({
      signal: buildSignal(),
      occurrenceCount: 3,
      existingCandidateId: null,
      cooldownUntil: new Date('2026-05-18T00:00:00.000Z'),
      now: NOW,
    });

    expect(decision).toEqual({
      promote: false,
      skippedReason: 'cooldown_active',
      cooldownUntil: null,
      resetWindow: false,
    });
  });

  it('skips promotion when the occurrence window has expired before enough signals arrive', () => {
    const decision = service.evaluate({
      signal: buildSignal({ confidence: 0.9, severity: 'medium' }),
      occurrenceCount: 3,
      windowStartedAt: new Date('2026-05-10T11:59:59.999Z'),
      existingCandidateId: null,
      cooldownUntil: null,
      now: new Date('2026-05-17T12:00:00.000Z'),
    });

    expect(decision).toEqual({
      promote: false,
      skippedReason: 'frequency_window_expired',
      cooldownUntil: null,
      resetWindow: true,
    });
  });
});
