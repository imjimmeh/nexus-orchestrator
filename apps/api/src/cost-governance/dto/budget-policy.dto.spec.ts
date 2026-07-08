import { describe, it, expect } from 'vitest';
import {
  createBudgetPolicySchema,
  updateBudgetPolicySchema,
} from './budget-policy.dto';

describe('createBudgetPolicySchema', () => {
  it('accepts a valid create payload', () => {
    const result = createBudgetPolicySchema.safeParse({
      name: 'Monthly LLM Cap',
      scope_type: 'global',
      scope_id: null,
      context_type: null,
      context_id: null,
      provider_name: null,
      model_name: null,
      soft_limit_cents: 5000,
      hard_limit_cents: 10000,
      token_limit: null,
      window: 'monthly',
      enforcement_mode: 'warn',
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = createBudgetPolicySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid enforcement_mode', () => {
    const result = createBudgetPolicySchema.safeParse({
      name: 'Test',
      scope_type: 'global',
      window: 'daily',
      enforcement_mode: 'invalid',
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateBudgetPolicySchema', () => {
  it('accepts a partial update with optional fields', () => {
    const result = updateBudgetPolicySchema.safeParse({
      soft_limit_cents: 2000,
      is_active: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty update object', () => {
    const result = updateBudgetPolicySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
