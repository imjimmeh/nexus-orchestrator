import { readLifecycleMergeMetadata } from "@nexus/kanban-contracts";
import type {
  StalledPullRequest,
  StalledPullRequestReason,
} from "./stalled-pull-request.types";

/** A PR open past this age (and not yet merged) is surfaced to the CEO as
 *  actionable even when its checks are green — it is not progressing. 24h. */
export const STALLED_PR_AGE_MS = 24 * 60 * 60 * 1000;

const AWAITING_PR_MERGE = "awaiting-pr-merge";

interface StalledWorkItemInput {
  id: string;
  title: string;
  status: string;
  metadata: unknown;
}

/**
 * Pure CEO stalled-PR detector. An `awaiting-pr-merge` item with PR merge
 * metadata is stalled when its checks are red, a reviewer requested changes, or
 * it has been open beyond STALLED_PR_AGE_MS. Healthy, fresh, green PRs are
 * excluded so the snapshot only flags CEO-actionable PRs.
 */
export function computeStalledPullRequests(
  items: ReadonlyArray<StalledWorkItemInput>,
  nowMs: number = Date.now(),
): StalledPullRequest[] {
  const stalled: StalledPullRequest[] = [];
  for (const item of items) {
    if (item.status !== AWAITING_PR_MERGE) continue;
    const merge = readLifecycleMergeMetadata(item.metadata);
    if (merge === null) continue;

    const reason = classify(merge, nowMs);
    if (reason !== null) {
      stalled.push({
        id: item.id,
        title: item.title,
        prUrl: merge.prUrl,
        reason,
      });
    }
  }
  return stalled;
}

function classify(
  merge: NonNullable<ReturnType<typeof readLifecycleMergeMetadata>>,
  nowMs: number,
): StalledPullRequestReason | null {
  if (merge.checks === "failing") return "red_checks";
  if (merge.reviewDecision === "changes_requested") return "changes_requested";
  const openedMs = Date.parse(merge.openedAt);
  if (Number.isFinite(openedMs) && nowMs - openedMs > STALLED_PR_AGE_MS) {
    return "stale_open";
  }
  return null;
}
