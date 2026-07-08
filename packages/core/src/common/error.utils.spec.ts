import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./error.utils";

describe("getErrorMessage", () => {
  it("returns the message for an Error object", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the string itself for string errors", () => {
    expect(getErrorMessage("something went wrong")).toBe(
      "something went wrong",
    );
  });

  it("returns JSON for plain objects", () => {
    const result = getErrorMessage({ code: 42 });
    expect(result).toContain("42");
  });

  it("returns a fallback string for null/undefined", () => {
    expect(getErrorMessage(null)).toBe("Unknown error");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
  });

  it("never throws", () => {
    expect(() => getErrorMessage(Symbol("x"))).not.toThrow();
  });
});
