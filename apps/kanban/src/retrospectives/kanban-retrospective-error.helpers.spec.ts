/**
 * Unit spec for the `formatUnknownErrorMessage` helper extracted in
 * M3 (work item ef4d6799-8468-4c4b-b8d6-20e8f0fca384). The helper is
 * a pure function so no NestJS testing module setup is required.
 */
import { describe, expect, it } from "vitest";
import { formatUnknownErrorMessage } from "./kanban-retrospective-error.helpers";

describe("formatUnknownErrorMessage", () => {
  it("returns the error.message when given a real Error instance", () => {
    expect(formatUnknownErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the error.message when given a subclass of Error", () => {
    class CustomError extends Error {}
    expect(formatUnknownErrorMessage(new CustomError("subclass boom"))).toBe(
      "subclass boom",
    );
  });

  it("returns String(...) when given a string primitive", () => {
    expect(formatUnknownErrorMessage("string failure")).toBe("string failure");
  });

  it("returns String(...) when given a number primitive", () => {
    expect(formatUnknownErrorMessage(42)).toBe("42");
  });

  it("returns the literal 'null' when given null without throwing", () => {
    expect(formatUnknownErrorMessage(null)).toBe("null");
  });

  it("returns the literal 'undefined' when given undefined without throwing", () => {
    expect(formatUnknownErrorMessage(undefined)).toBe("undefined");
  });
});