/**
 * Flattened tool-execution row consumed by the behaviour-change matcher
 * (EPIC-212 Phase 3, Task 6).
 *
 * The matcher is deliberately ignorant of the `event_ledger` row shape:
 * the terminal observer projects each `domain:'tool'` ledger row down to
 * this two-field record before matching, so the pure helper carries no
 * persistence coupling and is trivially unit-testable.
 *
 * - `toolName` — the invoked tool's name (`event.tool_name`), used for the
 *   exact tool-name match leg.
 * - `pathText` — any searchable text that may contain a file/code path the
 *   tool operated on (typically a serialisation of the ledger row's
 *   `payload`), used for the substring path-match leg.
 */
export interface AnchorMatchRow {
  toolName?: string;
  pathText?: string;
}
