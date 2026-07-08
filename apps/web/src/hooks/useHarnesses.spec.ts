import { describe, it, expect } from "vitest";
import {
  useHarnesses,
  useHarness,
  useCreateHarness,
  useUpdateHarness,
  useDeleteHarness,
  useValidateHarness,
} from "./useHarnesses";

describe("useHarnesses", () => {
  it("exports useHarnesses as a function", () => {
    expect(typeof useHarnesses).toBe("function");
  });

  it("exports useHarness as a function", () => {
    expect(typeof useHarness).toBe("function");
  });

  it("exports useCreateHarness as a function", () => {
    expect(typeof useCreateHarness).toBe("function");
  });

  it("exports useUpdateHarness as a function", () => {
    expect(typeof useUpdateHarness).toBe("function");
  });

  it("exports useDeleteHarness as a function", () => {
    expect(typeof useDeleteHarness).toBe("function");
  });

  it("exports useValidateHarness as a function", () => {
    expect(typeof useValidateHarness).toBe("function");
  });
});
