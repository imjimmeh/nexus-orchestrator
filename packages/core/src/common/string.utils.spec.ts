import { describe, it, expect } from "vitest";
import { normalizeOptionalString, isUuid } from "./string.utils";

describe("normalizeOptionalString", () => {
  it("returns null for non-string values", () => {
    expect(normalizeOptionalString(null)).toBeNull();
    expect(normalizeOptionalString(undefined)).toBeNull();
    expect(normalizeOptionalString(42)).toBeNull();
    expect(normalizeOptionalString({})).toBeNull();
  });

  it("returns null for empty or whitespace-only strings", () => {
    expect(normalizeOptionalString("")).toBeNull();
    expect(normalizeOptionalString("   ")).toBeNull();
    expect(normalizeOptionalString("\t\n")).toBeNull();
  });

  it("returns trimmed string for non-empty strings", () => {
    expect(normalizeOptionalString("hello")).toBe("hello");
    expect(normalizeOptionalString("  a  ")).toBe("a");
  });
});

describe("isUuid", () => {
  it("returns true for valid UUID strings", () => {
    expect(isUuid("458935f0-213e-4bbe-89d1-8883e0efa9ad")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D")).toBe(true);
  });

  it("returns false for invalid UUID strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("458935f0-213e-4bbe-89d1-8883e0efa9a")).toBe(false); // too short
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
