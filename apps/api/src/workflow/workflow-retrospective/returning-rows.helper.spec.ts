import { describe, expect, it } from 'vitest';
import { extractReturningRows } from './returning-rows.helper';

interface Row {
  id: string;
}

describe('extractReturningRows', () => {
  it('unwraps the [rows, affectedCount] tuple TypeORM returns for a RETURNING write', () => {
    // The postgres driver resolves `UPDATE ... RETURNING *` to a TWO-element
    // tuple: the row array at index 0, the affected count at index 1. The bug
    // (2026-06-29 windowed drain) was returning the whole tuple, so callers
    // iterated [rowsArray, count] as if each were a row.
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }];
    const result = extractReturningRows<Row>([rows, 2]);

    expect(result).toBe(rows);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
  });

  it('passes through a bare row array (the plain SELECT shape)', () => {
    const rows: Row[] = [{ id: 'a' }];
    expect(extractReturningRows<Row>(rows)).toEqual(rows);
  });

  it('returns [] for an empty RETURNING write ([[], 0])', () => {
    expect(extractReturningRows<Row>([[], 0])).toEqual([]);
  });

  it('returns [] for an empty SELECT result', () => {
    expect(extractReturningRows<Row>([])).toEqual([]);
  });

  it('returns [] for a non-array result (defensive)', () => {
    expect(extractReturningRows<Row>(undefined)).toEqual([]);
    expect(extractReturningRows<Row>(null)).toEqual([]);
  });
});
