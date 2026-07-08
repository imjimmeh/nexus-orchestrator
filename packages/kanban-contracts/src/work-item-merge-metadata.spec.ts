import { describe, expect, it } from "vitest";
import { readLifecycleMergeMetadata } from "./work-item-merge-metadata.types";

describe("readLifecycleMergeMetadata", () => {
  it("extracts checks/reviewDecision/openedAt/prUrl from lifecycle.merge", () => {
    const meta = readLifecycleMergeMetadata({
      lifecycle: {
        merge: {
          status: "pull_request_opened",
          strategy: "pull-request",
          prUrl: "https://github.com/acme/widgets/pull/42",
          checks: "failing",
          reviewDecision: "changes_requested",
          openedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    });
    expect(meta).toEqual({
      prUrl: "https://github.com/acme/widgets/pull/42",
      checks: "failing",
      reviewDecision: "changes_requested",
      openedAt: "2026-06-22T00:00:00.000Z",
    });
  });

  it("returns null when there is no PR merge metadata", () => {
    expect(
      readLifecycleMergeMetadata({
        lifecycle: { merge: { status: "succeeded" } },
      }),
    ).toBeNull();
    expect(readLifecycleMergeMetadata(null)).toBeNull();
    expect(readLifecycleMergeMetadata(undefined)).toBeNull();
    expect(readLifecycleMergeMetadata({})).toBeNull();
  });

  it("tolerates partial fields (unknown checks, missing review)", () => {
    const meta = readLifecycleMergeMetadata({
      lifecycle: {
        merge: {
          strategy: "pull-request",
          prUrl: "u",
          openedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    });
    expect(meta).toEqual({
      prUrl: "u",
      checks: "unknown",
      reviewDecision: "none",
      openedAt: "2026-06-22T00:00:00.000Z",
    });
  });
});
