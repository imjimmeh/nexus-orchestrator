/**
 * Input / output types for
 * {@link LearningMeasurementSnapshotRepository} (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1).
 *
 * Split out of the repository file to keep the repository
 * surface narrow and to honour the project's
 * `no-restricted-syntax` lint rule that bans exported
 * interfaces from non-`.types.ts` files. The repository
 * imports these types via a relative path so the file's public
 * surface stays the same.
 *
 * Mirrors the migration's NOT NULL constraint set — the
 * repository deliberately does NOT default any of the required
 * fields, so the caller (the recorder service) is forced to
 * think about every column at the call site. The two JSONB
 * histogram / decision-distribution columns accept `unknown` so
 * the recorder milestones can choose richer per-bucket shapes
 * without a schema change.
 */

import type { LearningMeasurementSnapshotSourceWindow } from '../entities/learning-measurement-snapshot.entity.types';

export interface LearningMeasurementSnapshotInput {
  source_window: LearningMeasurementSnapshotSourceWindow;
  promoted_to_bound_score: string;
  bound_to_reused_score: string;
  usefulness_histogram: Record<string, unknown>;
  retention_decision_distribution: Record<string, unknown>;
}

export type { LearningMeasurementSnapshotSourceWindow };
