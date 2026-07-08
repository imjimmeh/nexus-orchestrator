import type { HarnessId } from '@nexus/core';

interface HarnessSelectionDiag {
  harnessId: HarnessId;
  scope: { scopeNodeId?: string; agentProfile?: string };
  precedenceSource: string;
  fallback?: { from: string; to: string; reason: string };
}

export async function emitHarnessSelectionEvents(
  ledger: { emitBestEffort: (payload: unknown) => unknown },
  d: HarnessSelectionDiag,
): Promise<void> {
  await ledger.emitBestEffort({
    domain: 'harness',
    eventName: 'harness.selection.resolved',
    outcome: 'success',
    payload: {
      harnessId: d.harnessId,
      scope: d.scope,
      precedenceSource: d.precedenceSource,
    },
  });
  if (d.fallback) {
    await ledger.emitBestEffort({
      domain: 'harness',
      eventName: 'harness.selection.fallback',
      outcome: 'success',
      payload: d.fallback,
    });
  }
}
