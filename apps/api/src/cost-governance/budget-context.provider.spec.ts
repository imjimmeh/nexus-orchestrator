import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetContextProvider } from './budget-context.provider';

describe('BudgetContextProvider', () => {
  let provider: BudgetContextProvider;
  let mockPolicySvc: { listAll: ReturnType<typeof vi.fn> };
  let mockUsageRepo: { getSpendInWindow: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPolicySvc = { listAll: vi.fn() };
    mockUsageRepo = { getSpendInWindow: vi.fn() };

    provider = new BudgetContextProvider(
      mockPolicySvc as any,
      mockUsageRepo as any,
    );
  });

  it('returns a context block with budget summary', async () => {
    mockPolicySvc.listAll.mockResolvedValue([
      {
        name: 'Monthly Cap',
        enforcement_mode: 'warn',
        hard_limit_cents: 10000,
        soft_limit_cents: 5000,
        token_limit: null,
        window: 'monthly',
      },
    ]);
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 3500,
      totalTokens: 500000,
    });

    const block = await provider.build('ctx-1');

    expect(block).toContain('Budget');
    expect(block).toContain('Monthly Cap');
    expect(block).toContain('3500');
  });

  it('returns minimal block when no policies active', async () => {
    mockPolicySvc.listAll.mockResolvedValue([]);
    mockUsageRepo.getSpendInWindow.mockResolvedValue({
      totalCents: 0,
      totalTokens: 0,
    });

    const block = await provider.build('ctx-1');

    expect(block).toContain('Budget');
    expect(block).toContain('No active budget policies');
  });
});
