import { describe, it, expect } from "vitest";
import {
  asRecord,
  getNestedValue,
  isRecord,
  readString,
  requireNonEmptyString,
} from "./record-parsing.helpers";

describe("asRecord", () => {
  it("returns an empty object for null and undefined", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
  });

  it("returns an empty object for primitives", () => {
    expect(asRecord("hello")).toEqual({});
    expect(asRecord(42)).toEqual({});
    expect(asRecord(true)).toEqual({});
    expect(asRecord(false)).toEqual({});
    expect(asRecord(0)).toEqual({});
    expect(asRecord("")).toEqual({});
  });

  it("returns an empty object for arrays (typeof object but not a record)", () => {
    expect(asRecord([])).toEqual({});
    expect(asRecord([1, 2, 3])).toEqual({});
    expect(asRecord(["a", "b"])).toEqual({});
  });

  it("returns the input reference for plain object records", () => {
    const obj = { a: 1, b: "two" };
    expect(asRecord(obj)).toBe(obj);
  });

  it("returns the input reference for objects with prototype chains (not strict)", () => {
    // Predicate mirrors the codebase: does NOT check prototype. Class
    // instances pass through unchanged.
    class Box {
      value = 1;
    }
    const instance = new Box();
    expect(asRecord(instance)).toBe(instance);
  });

  it("returns the input reference for empty objects", () => {
    const obj = {};
    expect(asRecord(obj)).toBe(obj);
  });
});

describe("isRecord", () => {
  it("returns true for plain object records", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null and undefined", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("hello")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("narrows the type after the guard (compile-time guarantee)", () => {
    const value: unknown = { a: 1 };
    if (isRecord(value)) {
      // The following would fail to compile if the type guard does not narrow.
      const key: string = "a";
      const present = key in value;
      expect(present).toBe(true);
    } else {
      throw new Error("expected isRecord to return true");
    }
  });
});

describe("readString", () => {
  it("returns the value when it is a string", () => {
    expect(readString("hello")).toBe("hello");
    expect(readString("")).toBe("");
  });

  it("returns the value without trimming", () => {
    expect(readString("  spaces  ")).toBe("  spaces  ");
  });

  it("returns the fallback for non-strings when a fallback is provided", () => {
    expect(readString(null, "fb")).toBe("fb");
    expect(readString(undefined, "fb")).toBe("fb");
    expect(readString(42, "fb")).toBe("fb");
    expect(readString({}, "fb")).toBe("fb");
    expect(readString([], "fb")).toBe("fb");
  });

  it("returns undefined for non-strings when no fallback is provided", () => {
    expect(readString(null)).toBeUndefined();
    expect(readString(undefined)).toBeUndefined();
    expect(readString(42)).toBeUndefined();
    expect(readString({})).toBeUndefined();
    expect(readString([])).toBeUndefined();
    expect(readString(true)).toBeUndefined();
  });
});

describe("requireNonEmptyString", () => {
  it("returns the trimmed value for non-empty strings", () => {
    expect(requireNonEmptyString("hello", "name")).toBe("hello");
    expect(requireNonEmptyString("  trimmed  ", "name")).toBe("trimmed");
    expect(requireNonEmptyString("\tvalue\n", "name")).toBe("value");
  });

  it("throws for null and undefined", () => {
    expect(() => requireNonEmptyString(null, "name")).toThrow();
    expect(() => requireNonEmptyString(undefined, "name")).toThrow();
  });

  it("throws for non-string primitives", () => {
    expect(() => requireNonEmptyString(42, "name")).toThrow();
    expect(() => requireNonEmptyString(true, "name")).toThrow();
    expect(() => requireNonEmptyString({}, "name")).toThrow();
    expect(() => requireNonEmptyString([], "name")).toThrow();
  });

  it("throws for the empty string", () => {
    expect(() => requireNonEmptyString("", "name")).toThrow();
  });

  it("throws for whitespace-only strings", () => {
    expect(() => requireNonEmptyString("   ", "name")).toThrow();
    expect(() => requireNonEmptyString("\t\n", "name")).toThrow();
  });

  it("includes the field name in the error message", () => {
    expect(() => requireNonEmptyString(null, "workflow_id")).toThrow(
      /workflow_id/,
    );
    expect(() => requireNonEmptyString("", "user.email")).toThrow(/user\.email/);
    expect(() => requireNonEmptyString("   ", "trigger.kind")).toThrow(
      /trigger\.kind/,
    );
  });

  it("throws a plain Error (not a NestJS or other framework error)", () => {
    try {
      requireNonEmptyString(null, "name");
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      // Sanity check: not a NestJS HTTP exception subclass (those carry a
      // `status` property on their instances).
      expect((error as Error & { status?: unknown }).status).toBeUndefined();
    }
  });
});

describe("getNestedValue", () => {
  const fixture: Record<string, unknown> = {
    a: 1,
    nested: {
      b: 2,
      deeper: {
        c: 3,
        list: [{ d: 4 }, { e: 5 }],
      },
    },
    arr: [10, 20, 30],
    falsy: {
      zero: 0,
      empty: "",
      no: false,
      nil: null,
    },
  };

  it("returns the root value for an empty path", () => {
    expect(getNestedValue(fixture, [])).toBe(fixture);
  });

  it("returns the value at a single-key path", () => {
    expect(getNestedValue(fixture, ["a"])).toBe(1);
  });

  it("returns nested values for multi-key paths", () => {
    expect(getNestedValue(fixture, ["nested", "b"])).toBe(2);
    expect(getNestedValue(fixture, ["nested", "deeper", "c"])).toBe(3);
  });

  it("returns undefined when a top-level key is missing", () => {
    expect(getNestedValue(fixture, ["missing"])).toBeUndefined();
  });

  it("returns undefined when a nested key is missing", () => {
    expect(getNestedValue(fixture, ["nested", "missing"])).toBeUndefined();
    expect(
      getNestedValue(fixture, ["nested", "deeper", "missing"]),
    ).toBeUndefined();
  });

  it("returns undefined when an intermediate value is not an object", () => {
    // `a` is a number, so we cannot traverse past it.
    expect(getNestedValue(fixture, ["a", "b"])).toBeUndefined();
    // `nested.b` is a number.
    expect(getNestedValue(fixture, ["nested", "b", "c"])).toBeUndefined();
    // `arr` is an array.
    expect(getNestedValue(fixture, ["arr", "first"])).toBeUndefined();
  });

  it("treats falsy object values as records (does not bail on null/0/false inside)", () => {
    // The traversal only stops when the CURRENT slot is not a record. Reading
    // a falsy value out of a record (the leaf) must succeed.
    expect(getNestedValue(fixture, ["falsy", "zero"])).toBe(0);
    expect(getNestedValue(fixture, ["falsy", "empty"])).toBe("");
    expect(getNestedValue(fixture, ["falsy", "no"])).toBe(false);
    expect(getNestedValue(fixture, ["falsy", "nil"])).toBeNull();
  });

  it("returns undefined when traversal crosses through null", () => {
    // `falsy.nil` is null, so the next segment must short-circuit.
    expect(getNestedValue(fixture, ["falsy", "nil", "anything"])).toBeUndefined();
  });
});