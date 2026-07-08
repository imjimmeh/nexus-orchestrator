/** VCS-neutral PR observation snapshot the API reconciler records onto a work
 *  item's metadata.lifecycle.merge. Kanban reads this; it never queries the
 *  provider directly. */
export interface LifecycleMergeMetadata {
  prUrl: string;
  checks: "pending" | "passing" | "failing" | "unknown";
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  openedAt: string; // ISO 8601
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CHECKS = new Set(["pending", "passing", "failing", "unknown"]);
const REVIEW = new Set([
  "approved",
  "changes_requested",
  "review_required",
  "none",
]);

export function readLifecycleMergeMetadata(
  metadata: unknown,
): LifecycleMergeMetadata | null {
  if (!isRecord(metadata)) return null;
  const lifecycle = metadata["lifecycle"];
  if (!isRecord(lifecycle)) return null;
  const merge = lifecycle["merge"];
  if (!isRecord(merge)) return null;
  const prUrl = merge["prUrl"];
  const openedAt = merge["openedAt"];
  if (typeof prUrl !== "string" || typeof openedAt !== "string") return null;

  const checksRaw = merge["checks"];
  const reviewRaw = merge["reviewDecision"];
  return {
    prUrl,
    openedAt,
    checks:
      typeof checksRaw === "string" && CHECKS.has(checksRaw)
        ? (checksRaw as LifecycleMergeMetadata["checks"])
        : "unknown",
    reviewDecision:
      typeof reviewRaw === "string" && REVIEW.has(reviewRaw)
        ? (reviewRaw as LifecycleMergeMetadata["reviewDecision"])
        : "none",
  };
}
