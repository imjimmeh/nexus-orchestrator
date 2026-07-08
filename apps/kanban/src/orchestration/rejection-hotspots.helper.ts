export type {
  FailedDeliverableLike,
  RejectionFeedbackLike,
  RejectionHotspot,
} from "./rejection-hotspots.types";
import type {
  FailedDeliverableLike,
  RejectionFeedbackLike,
  RejectionHotspot,
} from "./rejection-hotspots.types";

export function normalizeArea(file: string, depth: number): string {
  const parts = file.split("/").filter((part) => part && part !== ".");
  return `${parts.slice(0, depth).join("/")}/*`;
}

/**
 * Normalize a value that should be an array but may have been serialized as a
 * JSONB object with numeric string keys (a known PostgreSQL/TypeORM artifact
 * when arrays of objects are stored in and retrieved from JSONB columns).
 */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object")
    return Object.values(value as Record<string, T>);
  return [];
}

export function aggregateRejectionHotspots(
  feedbacks: RejectionFeedbackLike[],
  depth: number,
): RejectionHotspot[] {
  const byArea = new Map<string, RejectionHotspot>();

  for (const feedback of feedbacks) {
    const deliverables = asArray<FailedDeliverableLike>(
      feedback.failedDeliverables ?? feedback.failed_deliverables ?? [],
    );
    for (const deliverable of deliverables) {
      for (const file of asArray<string>(deliverable.affected_files)) {
        const area = normalizeArea(file, depth);
        const hotspot = byArea.get(area) ?? {
          area,
          count: 0,
          failureTypes: {},
        };
        hotspot.count += 1;
        hotspot.failureTypes[deliverable.failure_type] =
          (hotspot.failureTypes[deliverable.failure_type] ?? 0) + 1;
        byArea.set(area, hotspot);
      }
    }
  }

  return [...byArea.values()].sort((a, b) => b.count - a.count);
}
