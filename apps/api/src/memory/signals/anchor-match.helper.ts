import type { LessonAnchor } from './lesson-anchor.types';
import type { AnchorMatchRow } from './anchor-match.types';

/**
 * Pure behaviour-change matcher (EPIC-212 Phase 3, Task 6).
 *
 * Answers: "did this run actually exercise the lesson's anchored
 * tool / path?" given the run's tool-execution rows and the lesson's
 * {@link LessonAnchor}.
 *
 * Match contract (recorded from Pre-flight #6):
 *   - **tool leg** — EXACT tool-name match (`row.toolName === anchor.tool`).
 *   - **path leg** — SUBSTRING match (`row.pathText` includes `anchor.path`).
 *   - A row satisfies the anchor when EVERY present leg is satisfied on
 *     that SAME row (so "tool X invoked ON path Y" requires one row whose
 *     tool is X and whose text contains Y). A run matches the anchor when
 *     ANY row satisfies it.
 *   - **No anchor → never counted.** An anchor with neither `tool` nor
 *     `path` returns `false` (no false negatives: an unanchored lesson is
 *     simply excluded from the behaviour-change denominator upstream).
 *
 * The function never throws and inspects no domain-specific fields, so it
 * is safe to call on every drained inject record.
 */
export function matchesAnchor(
  rows: ReadonlyArray<AnchorMatchRow>,
  anchor: LessonAnchor,
): boolean {
  const tool = normalize(anchor.tool);
  const path = normalize(anchor.path);
  if (tool === undefined && path === undefined) {
    return false;
  }
  return rows.some((row) => rowSatisfies(row, tool, path));
}

function rowSatisfies(
  row: AnchorMatchRow,
  tool: string | undefined,
  path: string | undefined,
): boolean {
  const toolOk =
    tool === undefined ||
    (typeof row.toolName === 'string' && row.toolName === tool);
  const pathOk =
    path === undefined ||
    (typeof row.pathText === 'string' && row.pathText.includes(path));
  return toolOk && pathOk;
}

function normalize(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
