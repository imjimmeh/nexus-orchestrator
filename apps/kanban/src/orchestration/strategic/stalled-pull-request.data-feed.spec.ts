import { describe, expect, it, vi } from "vitest";
import { computeStalledPullRequests } from "./stalled-pull-request.helpers";
import { CoreLifecycleStreamPrStatusHandler } from "../../core/core-lifecycle-stream-pr-status.handler";

/**
 * End-to-end proof that the stalled-PR data feed is wired: the seed
 * record_pr_metadata job stamps `openedAt` onto lifecycle.merge at PR open, and
 * the pr_status handler then patches `checks`/`reviewDecision` each poll tick.
 * Composing the real handler output through the real detector demonstrates the
 * gap is closed — without these writes the detector always returned [].
 */

const PR_URL = "https://github.com/acme/widgets/pull/42";
const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();

/** Mirrors what the seed record_pr_metadata MCP patch lands at PR open. */
function openMergeMetadata(openedAtMs: number) {
  return {
    lifecycle: {
      merge: {
        status: "pull_request_opened",
        strategy: "pull-request",
        prUrl: PR_URL,
        prNumber: 42,
        openedAt: new Date(openedAtMs).toISOString(),
      },
    },
  };
}

/** Runs the REAL pr_status handler against an in-memory work item, returning
 *  the metadata it patched (what the next detector pass would read). */
async function applyPrStatus(
  metadata: Record<string, unknown>,
  status: { checks: "passing" | "failing"; reviewDecision: string },
): Promise<Record<string, unknown>> {
  let stored = metadata;
  const workItems = {
    findByProjectAndId: vi
      .fn()
      .mockResolvedValue({ id: "wi-1", status: "awaiting-pr-merge", metadata }),
  };
  const workItemService = {
    updateStatus: vi.fn(),
    updateWorkItem: vi.fn(
      (
        _p: string,
        _w: string,
        patch: { metadata: Record<string, unknown> },
      ) => {
        stored = patch.metadata;
        return Promise.resolve(undefined);
      },
    ),
  };
  const handler = new CoreLifecycleStreamPrStatusHandler(
    workItems as never,
    workItemService as never,
  );
  await handler.handle({
    scopeId: "project-1",
    contextId: "wi-1",
    prUrl: PR_URL,
    checks: status.checks,
    reviewDecision: status.reviewDecision as never,
  });
  return stored;
}

describe("stalled-PR data feed (openedAt stamp + pr_status patch -> detector)", () => {
  it("flags red_checks after a pr_status patch lands failing checks on a fresh open PR", async () => {
    const opened = openMergeMetadata(NOW - 60_000); // 1 min old
    const patched = await applyPrStatus(opened, {
      checks: "failing",
      reviewDecision: "review_required",
    });

    const stalled = computeStalledPullRequests(
      [
        {
          id: "wi-1",
          title: "feature work",
          status: "awaiting-pr-merge",
          metadata: patched,
        },
      ],
      NOW,
    );

    expect(stalled).toEqual([
      {
        id: "wi-1",
        title: "feature work",
        prUrl: PR_URL,
        reason: "red_checks",
      },
    ]);
  });

  it("does NOT flag a healthy fresh open PR after a passing pr_status patch", async () => {
    const opened = openMergeMetadata(NOW - 60_000);
    const patched = await applyPrStatus(opened, {
      checks: "passing",
      reviewDecision: "approved",
    });

    const stalled = computeStalledPullRequests(
      [
        {
          id: "wi-1",
          title: "feature work",
          status: "awaiting-pr-merge",
          metadata: patched,
        },
      ],
      NOW,
    );

    expect(stalled).toEqual([]);
  });

  it("without the openedAt stamp the detector cannot read the merge metadata (regression guard)", () => {
    const noOpenedAt = {
      lifecycle: { merge: { status: "pull_request_opened", prUrl: PR_URL } },
    };
    const stalled = computeStalledPullRequests(
      [
        {
          id: "wi-1",
          title: "feature work",
          status: "awaiting-pr-merge",
          metadata: noOpenedAt,
        },
      ],
      NOW,
    );
    expect(stalled).toEqual([]);
  });
});
