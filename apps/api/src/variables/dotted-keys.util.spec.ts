import { describe, it, expect } from 'vitest';
import { expandDottedKeys } from './dotted-keys.util';

describe('expandDottedKeys', () => {
  it('expands dotted keys into nested objects', () => {
    const result = expandDottedKeys({
      'gates.rediscovery_merge_threshold': 10,
      'backlog.ideation_enabled': true,
      'autonomy.dispatch': 'auto',
    });
    expect(result).toEqual({
      gates: { rediscovery_merge_threshold: 10 },
      backlog: { ideation_enabled: true },
      autonomy: { dispatch: 'auto' },
    });
  });

  it('keeps flat keys flat', () => {
    expect(expandDottedKeys({ flat: 1 })).toEqual({ flat: 1 });
  });
});
