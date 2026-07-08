import { describe, expect, it } from "vitest";
import { computeUnifiedDiff, countDiff } from "./diff";

describe("computeUnifiedDiff", () => {
  it("returns single replace as one - and one + line", () => {
    const diff = computeUnifiedDiff("a\nb\nc", "a\nB\nc");
    expect(diff).toEqual([
      { type: "context", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "context", text: "c" },
    ]);
  });
  it("returns pure addition", () => {
    const diff = computeUnifiedDiff("a", "a\nb");
    expect(diff).toEqual([
      { type: "context", text: "a" },
      { type: "add", text: "b" },
    ]);
  });
  it("returns pure deletion", () => {
    const diff = computeUnifiedDiff("a\nb", "a");
    expect(diff).toEqual([
      { type: "context", text: "a" },
      { type: "del", text: "b" },
    ]);
  });
  it("returns full replace when nothing shared", () => {
    const diff = computeUnifiedDiff("foo", "bar");
    expect(diff).toEqual([
      { type: "del", text: "foo" },
      { type: "add", text: "bar" },
    ]);
  });
  it("handles empty old", () => {
    const diff = computeUnifiedDiff("", "x");
    expect(diff).toEqual([{ type: "add", text: "x" }]);
  });
  it("handles empty new", () => {
    const diff = computeUnifiedDiff("x", "");
    expect(diff).toEqual([{ type: "del", text: "x" }]);
  });
});

describe("countDiff", () => {
  it("countDiff returns added and removed counts", () => {
    expect(
      countDiff([
        { type: "add", text: "x" },
        { type: "del", text: "y" },
        { type: "context", text: "z" },
      ]),
    ).toEqual({ added: 1, removed: 1 });
  });
  it("countDiff returns zeros for all-context list", () => {
    expect(
      countDiff([
        { type: "context", text: "a" },
        { type: "context", text: "b" },
      ]),
    ).toEqual({ added: 0, removed: 0 });
  });
  it("countDiff returns zeros for empty list", () => {
    expect(countDiff([])).toEqual({ added: 0, removed: 0 });
  });
});
