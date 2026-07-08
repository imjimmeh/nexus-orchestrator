import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECISION_HISTORY_LIMIT,
  MAX_DECISION_HISTORY_LIMIT,
  selectRecentWindow,
} from "./decision-window.helper";

describe("selectRecentWindow", () => {
  const range = (count: number): number[] =>
    Array.from({ length: count }, (_, index) => index + 1);

  it("returns an empty array for an empty input", () => {
    expect(selectRecentWindow([])).toEqual([]);
  });

  it("returns the whole input when it has fewer items than the limit", () => {
    expect(selectRecentWindow([1, 2, 3], { limit: 10 })).toEqual([1, 2, 3]);
  });

  it("returns the whole input when it has exactly the limit", () => {
    expect(selectRecentWindow([1, 2, 3], { limit: 3 })).toEqual([1, 2, 3]);
  });

  it("returns the most-recent tail in chronological order when over the limit", () => {
    expect(selectRecentWindow([1, 2, 3, 4, 5], { limit: 2 })).toEqual([4, 5]);
  });

  it("pages backwards into history with offset, preserving order", () => {
    expect(
      selectRecentWindow([1, 2, 3, 4, 5], { limit: 2, offset: 2 }),
    ).toEqual([2, 3]);
  });

  it("returns an empty array when offset skips past the whole input", () => {
    expect(selectRecentWindow([1, 2, 3], { limit: 2, offset: 5 })).toEqual([]);
  });

  it("clamps the limit to MAX_DECISION_HISTORY_LIMIT", () => {
    const items = range(MAX_DECISION_HISTORY_LIMIT + 50);
    const result = selectRecentWindow(items, {
      limit: MAX_DECISION_HISTORY_LIMIT + 25,
    });
    expect(result).toHaveLength(MAX_DECISION_HISTORY_LIMIT);
    expect(result.at(-1)).toBe(items.at(-1));
  });

  it("clamps a limit below 1 up to 1", () => {
    expect(selectRecentWindow([1, 2, 3], { limit: 0 })).toEqual([3]);
  });

  it("defaults to DEFAULT_DECISION_HISTORY_LIMIT when limit is undefined", () => {
    const items = range(DEFAULT_DECISION_HISTORY_LIMIT + 10);
    const result = selectRecentWindow(items);
    expect(result).toHaveLength(DEFAULT_DECISION_HISTORY_LIMIT);
    expect(result.at(-1)).toBe(items.at(-1));
  });

  it("treats a negative offset as 0", () => {
    expect(selectRecentWindow([1, 2, 3], { limit: 2, offset: -5 })).toEqual([
      2, 3,
    ]);
  });
});
