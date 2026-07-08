import { describe, it, expect } from 'vitest';
import { ScopedAiDefaultEntity } from './scoped-ai-default.entity';

describe('ScopedAiDefaultEntity', () => {
  it('holds scope + harness + model + provider fields', () => {
    const e = new ScopedAiDefaultEntity();
    e.id = '11111111-1111-1111-1111-111111111111';
    e.scopeNodeId = null;
    e.harnessId = 'claude-code';
    e.modelName = 'claude-sonnet-4';
    e.providerName = 'anthropic';

    expect(e.scopeNodeId).toBeNull();
    expect(e.harnessId).toBe('claude-code');
    expect(e.modelName).toBe('claude-sonnet-4');
    expect(e.providerName).toBe('anthropic');
  });

  it('allows every default field to be null (a row may set only some fields)', () => {
    const e = new ScopedAiDefaultEntity();
    e.scopeNodeId = 'scope-a';
    e.harnessId = null;
    e.modelName = null;
    e.providerName = null;

    expect(e.harnessId).toBeNull();
    expect(e.modelName).toBeNull();
    expect(e.providerName).toBeNull();
  });
});
