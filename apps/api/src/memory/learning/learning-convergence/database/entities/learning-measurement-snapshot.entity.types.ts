/**
 * Type aliases for
 * {@link LearningMeasurementSnapshot} (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1).
 *
 * Split out of the entity file to honour the project's
 * `no-restricted-syntax` lint rule that bans exported type
 * aliases from non-`.types.ts` files. The entity imports the
 * alias via a relative path so the entity file's public
 * surface stays the same.
 *
 * Mirrors the migration's `varchar(8)` ceiling on
 * `source_window` — the alias is a closed enum of the
 * recorder's three operating windows so any future window
 * string (e.g. `'90d'`) forces a deliberate TypeScript change
 * here instead of silently widening the column.
 */
export type LearningMeasurementSnapshotSourceWindow = '24h' | '7d' | '30d';
