import { describe, expect, it } from 'vitest';
import { resolveTriggerContext } from './agent-scope.utils';

describe('resolveTriggerContext', () => {
  it('maps contextId from camelCase scope payload', () => {
    const context = resolveTriggerContext({
      scopeId: 'scope-1',
      contextId: 'context-1',
    });

    expect(context.scopeId).toBe('scope-1');
    expect(context.contextId).toBe('context-1');
  });

  it('maps context_id from legacy snake_case scope payload', () => {
    const context = resolveTriggerContext({
      scope_id: 'scope-1',
      context_id: 'context-1',
    });

    expect(context.scopeId).toBe('scope-1');
    expect(context.contextId).toBe('context-1');
  });

  it('prefers explicit contextId over context_id', () => {
    const context = resolveTriggerContext({
      scopeId: 'scope-1',
      contextId: 'context-1',
      context_id: 'legacy-context-id',
    });

    expect(context.scopeId).toBe('scope-1');
    expect(context.contextId).toBe('context-1');
  });
});
