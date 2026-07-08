import { describe, expect, it } from "vitest";
import { csvToArray } from "./csv-to-array.helper";

describe("csvToArray", () => {
  it("splits a comma-separated string and trims whitespace", () => {
    expect(csvToArray("a,b, c ")).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for an empty string", () => {
    expect(csvToArray("")).toBeUndefined();
  });

  it("drops empty entries produced by consecutive commas", () => {
    expect(csvToArray("a,,b,")).toEqual(["a", "b"]);
  });

  it("returns undefined when every entry is empty/whitespace-only", () => {
    expect(csvToArray(" , , ")).toBeUndefined();
  });

  it("returns a single-element array for a value with no commas", () => {
    expect(csvToArray("solo")).toEqual(["solo"]);
  });

  it("passes through an already-parsed array unchanged (trimmed)", () => {
    expect(csvToArray(["a", " b ", "c"])).toEqual(["a", "b", "c"]);
  });

  it("drops empty/whitespace-only entries from an array", () => {
    expect(csvToArray([" pending ", "", "approved"])).toEqual([
      "pending",
      "approved",
    ]);
  });

  it("returns undefined for an empty array", () => {
    expect(csvToArray([])).toBeUndefined();
  });

  it("filters out non-string elements from an array", () => {
    expect(csvToArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
  });

  it("returns undefined for undefined", () => {
    expect(csvToArray(undefined)).toBeUndefined();
  });

  it("returns undefined for non-string, non-array values", () => {
    expect(csvToArray(42)).toBeUndefined();
    expect(csvToArray(null)).toBeUndefined();
    expect(csvToArray({})).toBeUndefined();
  });
});
