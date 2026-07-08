import { describe, expect, it } from "vitest";
import {
  STALLED_PR_AGE_MS,
  computeStalledPullRequests,
} from "./stalled-pull-request.helpers";

const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();

function item(
  id: string,
  status: string,
  merge: Record<string, unknown> | null,
) {
  return {
    id,
    title: `item ${id}`,
    status,
    metadata: merge ? { lifecycle: { merge } } : null,
  };
}

const HEALTHY = {
  status: "pull_request_opened",
  strategy: "pull-request",
  prUrl: "https://github.com/acme/widgets/pull/1",
  checks: "passing",
  reviewDecision: "approved",
  openedAt: new Date(NOW - 60_000).toISOString(), // 1 min old
};

describe("computeStalledPullRequests", () => {
  it("exposes STALLED_PR_AGE_MS as a named 24h constant", () => {
    expect(STALLED_PR_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("excludes a healthy, fresh, green open PR", () => {
    const result = computeStalledPullRequests(
      [item("wi-1", "awaiting-pr-merge", HEALTHY)],
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("flags a PR with failing checks", () => {
    const result = computeStalledPullRequests(
      [item("wi-2", "awaiting-pr-merge", { ...HEALTHY, checks: "failing" })],
      NOW,
    );
    expect(result).toEqual([
      {
        id: "wi-2",
        title: "item wi-2",
        prUrl: HEALTHY.prUrl,
        reason: "red_checks",
      },
    ]);
  });

  it("flags a PR with changes_requested", () => {
    const result = computeStalledPullRequests(
      [
        item("wi-3", "awaiting-pr-merge", {
          ...HEALTHY,
          reviewDecision: "changes_requested",
        }),
      ],
      NOW,
    );
    expect(result[0]).toMatchObject({
      id: "wi-3",
      reason: "changes_requested",
    });
  });

  it("flags a green PR that has been open beyond STALLED_PR_AGE_MS", () => {
    const result = computeStalledPullRequests(
      [
        item("wi-4", "awaiting-pr-merge", {
          ...HEALTHY,
          openedAt: new Date(NOW - STALLED_PR_AGE_MS - 1).toISOString(),
        }),
      ],
      NOW,
    );
    expect(result[0]).toMatchObject({ id: "wi-4", reason: "stale_open" });
  });

  it("ignores items that are not awaiting-pr-merge", () => {
    const result = computeStalledPullRequests(
      [item("wi-5", "in-progress", { ...HEALTHY, checks: "failing" })],
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("ignores awaiting-pr-merge items without PR merge metadata", () => {
    const result = computeStalledPullRequests(
      [item("wi-6", "awaiting-pr-merge", null)],
      NOW,
    );
    expect(result).toEqual([]);
  });
});
