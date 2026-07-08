/**
 * Input / output types for
 * {@link MemoryRetentionPolicyRepository} (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1).
 *
 * Split out of the repository file to keep the repository
 * surface narrow and to honour the project's
 * `no-restricted-syntax` lint rule that bans exported
 * interfaces from non-`.types.ts` files. The repository
 * imports these types via a relative path so the file's public
 * surface stays the same.
 *
 * The `threshold` parameter is typed as `number` (NOT `string`)
 * because the recorder computes it in floating-point and the
 * repository is the only boundary that needs to convert it to
 * the Postgres `numeric` string form — callers can stay in JS
 * number-land and let the repository own the wire-format
 * coercion. The `thresholdEpsilon` parameter is the
 * `Math.abs(new − current) < ε` cut-off the repository uses to
 * skip the round trip when the recorder's proposed threshold
 * has not moved enough to justify a `recalibrated_at` bump.
 */

export type MemoryRetentionPolicyUpsertOutcome = 'applied' | 'no_change';

export interface MemoryRetentionPolicyUpsertResult {
  outcome: MemoryRetentionPolicyUpsertOutcome;
  row: import('../entities/memory-retention-policy.entity').MemoryRetentionPolicy;
}
