import { describe, expect, it } from "vitest";
import {
  asRecord,
  readNumber,
  readPath,
  readString,
} from "@/lib/deep-paths";

describe("asRecord", () => {
  it("returns null for null input", () => {
    expect(asRecord(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(asRecord(undefined)).toBeNull();
  });

  it("returns null for array input", () => {
    expect(asRecord(["a", "b"])).toBeNull();
  });

  it("returns null for primitive inputs", () => {
    expect(asRecord("string")).toBeNull();
    expect(asRecord(42)).toBeNull();
    expect(asRecord(true)).toBeNull();
  });

  it("returns the object for a plain record", () => {
    const record = { a: 1 };
    expect(asRecord(record)).toBe(record);
  });
});

describe("readPath", () => {
  it("returns the value at a nested path", () => {
    expect(readPath({ a: { b: 2 } }, ["a", "b"])).toBe(2);
  });

  it("returns undefined for null input", () => {
    expect(readPath(null, ["a"])).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(readPath(undefined, ["a"])).toBeUndefined();
  });

  it("returns undefined when a key is missing", () => {
    expect(readPath({ a: {} }, ["a", "b"])).toBeUndefined();
  });

  it("returns undefined when a path segment is not a record", () => {
    expect(readPath({ a: "not-a-record" }, ["a", "b"])).toBeUndefined();
  });

  it("returns the root value for an empty path", () => {
    const root = { a: 1 };
    expect(readPath(root, [])).toBe(root);
  });
});

describe("readString", () => {
  it("returns undefined for an empty or whitespace-only string", () => {
    expect(readString({ k: " " }, ["k"])).toBeUndefined();
    expect(readString({ k: "" }, ["k"])).toBeUndefined();
  });

  it("trims and returns a non-empty string", () => {
    expect(readString({ k: "  hello  " }, ["k"])).toBe("hello");
  });

  it("returns undefined for null/undefined input", () => {
    expect(readString(null, ["k"])).toBeUndefined();
    expect(readString(undefined, ["k"])).toBeUndefined();
  });

  it("returns undefined when the key is missing", () => {
    expect(readString({ other: "value" }, ["k"])).toBeUndefined();
  });

  it("skips non-string values and falls back to later keys", () => {
    expect(
      readString({ a: 1, b: null, c: "valid" }, ["a", "b", "c"]),
    ).toBe("valid");
  });

  it("returns the first valid string in key order", () => {
    expect(
      readString({ a: "first", b: "second" }, ["a", "b"]),
    ).toBe("first");
  });

  it("supports a single-value overload", () => {
    expect(readString("  text  ")).toBe("text");
    expect(readString("   ")).toBeUndefined();
    expect(readString(123)).toBeUndefined();
  });
});

describe("readNumber", () => {
  it("returns 0 for a numeric zero", () => {
    expect(readNumber({ n: 0 }, ["n"])).toBe(0);
  });

  it("returns undefined for null/undefined input", () => {
    expect(readNumber(null, ["n"])).toBeUndefined();
    expect(readNumber(undefined, ["n"])).toBeUndefined();
  });

  it("returns undefined when the key is missing", () => {
    expect(readNumber({ other: 1 }, ["n"])).toBeUndefined();
  });

  it("parses a numeric string", () => {
    expect(readNumber({ n: "3.14" }, ["n"])).toBe(3.14);
  });

  it("returns undefined for non-finite numbers", () => {
    expect(readNumber({ n: NaN }, ["n"])).toBeUndefined();
    expect(readNumber({ n: Infinity }, ["n"])).toBeUndefined();
  });

  it("returns undefined for values that cannot coerce to a finite number", () => {
    expect(readNumber({ n: "" }, ["n"])).toBeUndefined();
    expect(readNumber({ n: "not-a-number" }, ["n"])).toBeUndefined();
    expect(readNumber({ n: null }, ["n"])).toBeUndefined();
    expect(readNumber({ n: undefined }, ["n"])).toBeUndefined();
    expect(readNumber({ n: ["x"] }, ["n"])).toBeUndefined();
  });

  it("falls back to later keys when earlier values are invalid", () => {
    expect(
      readNumber({ a: "bad", b: undefined, c: 7 }, ["a", "b", "c"]),
    ).toBe(7);
  });

  it("supports a single-value overload", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber("42")).toBe(42);
    expect(readNumber("0")).toBe(0);
    expect(readNumber(NaN)).toBeUndefined();
    expect(readNumber(null)).toBeUndefined();
    expect(readNumber(undefined)).toBeUndefined();
    expect(readNumber(["x"])).toBeUndefined();
  });
});
