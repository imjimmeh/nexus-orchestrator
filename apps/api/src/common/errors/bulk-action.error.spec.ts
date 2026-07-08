import { describe, expect, it } from 'vitest';

import { BulkActionError } from './bulk-action.error';

describe('BulkActionError', () => {
  it('carries the failure code and offending ids', () => {
    const error = new BulkActionError('invalid_status', ['a', 'b']);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BulkActionError');
    expect(error.code).toBe('invalid_status');
    expect(error.ids).toEqual(['a', 'b']);
    expect(error.message).toContain('a');
    expect(error.message).toContain('b');
  });
});
