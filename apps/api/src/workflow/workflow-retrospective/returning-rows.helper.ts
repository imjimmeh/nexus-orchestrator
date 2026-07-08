/**
 * Normalise the result of a raw `EntityManager.query` for a writing statement
 * (`UPDATE` / `INSERT` / `DELETE`) that carries a `RETURNING` clause.
 *
 * On the postgres driver TypeORM resolves such a query to a TWO-element tuple
 * `[rows, affectedCount]` — NOT the bare row array a plain `SELECT` yields.
 * Reading the result as if it were already the row array iterates the
 * rows-array and the count as if each were a row (the 2026-06-29 windowed-drain
 * bug: every claimed row reached the digest with an undefined id).
 *
 * This helper accepts either shape and always returns the row array:
 *  - `[rows, count]` (RETURNING write) → `rows`
 *  - `rows`          (plain SELECT)    → `rows`
 *  - anything else                      → `[]`
 */
export function extractReturningRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
