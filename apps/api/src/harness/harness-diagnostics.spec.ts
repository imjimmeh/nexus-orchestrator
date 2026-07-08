import { vi, it, expect } from 'vitest';
import { emitHarnessSelectionEvents } from './harness-diagnostics';

it('emits resolved + fallback ledger events when fallback present', async () => {
  const ledger = { emitBestEffort: vi.fn() };
  await emitHarnessSelectionEvents(ledger, {
    harnessId: 'pi',
    scope: { scopeNodeId: 'p' },
    precedenceSource: 'profileDefault',
    fallback: { from: 'claude-code', to: 'pi', reason: 'branching' },
  });
  expect(ledger.emitBestEffort).toHaveBeenCalledWith(
    expect.objectContaining({ eventName: 'harness.selection.resolved' }),
  );
  expect(ledger.emitBestEffort).toHaveBeenCalledWith(
    expect.objectContaining({ eventName: 'harness.selection.fallback' }),
  );
});

it('emits only resolved event when no fallback', async () => {
  const ledger = { emitBestEffort: vi.fn() };
  await emitHarnessSelectionEvents(ledger, {
    harnessId: 'pi',
    scope: {},
    precedenceSource: 'platformDefault',
  });
  expect(ledger.emitBestEffort).toHaveBeenCalledTimes(1);
  expect(ledger.emitBestEffort).toHaveBeenCalledWith(
    expect.objectContaining({ eventName: 'harness.selection.resolved' }),
  );
});
