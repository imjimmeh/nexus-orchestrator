import { describe, expect, it } from "vitest";

import {
  getSplitParentId,
  withCanonicalSplitParentId,
} from "./split-work-item-metadata.helper";

describe("split work item metadata", () => {
  it("reads canonical parent ids", () => {
    expect(getSplitParentId({ split: { parentId: "parent-1" } })).toBe(
      "parent-1",
    );
  });

  it("falls back to legacy parent_context_id", () => {
    expect(getSplitParentId({ parent_context_id: "parent-legacy" })).toBe(
      "parent-legacy",
    );
  });

  it("prefers canonical parent ids over legacy ids", () => {
    expect(
      getSplitParentId({
        split: { parentId: "parent-canonical" },
        parent_context_id: "parent-legacy",
      }),
    ).toBe("parent-canonical");
  });

  it("returns undefined for invalid parent metadata", () => {
    expect(getSplitParentId(null)).toBeUndefined();
    expect(getSplitParentId({ split: { parentId: "" } })).toBeUndefined();
  });

  it("canonicalizes legacy parent metadata without dropping authored fields", () => {
    expect(
      withCanonicalSplitParentId({
        parent_context_id: "parent-1",
        ac_ids: ["AC-1"],
      }),
    ).toEqual({
      parent_context_id: "parent-1",
      ac_ids: ["AC-1"],
      split: { parentId: "parent-1" },
    });
  });
});
