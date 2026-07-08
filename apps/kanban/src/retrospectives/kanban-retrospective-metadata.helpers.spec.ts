/**
 * Unit spec for the `narrowMetadataRecord` helper extracted in M4
 * (work item ef4d6799-8468-4c4b-b8d6-20e8f0fca384). The helper is
 * a pure function so no NestJS testing module setup is required.
 */
import { describe, expect, it } from "vitest";
import { narrowMetadataRecord } from "./kanban-retrospective-metadata.helpers";

describe("narrowMetadataRecord", () => {
  it("returns the object unchanged when given a plain record", () => {
    const record = { a: 1, b: "x" };

    expect(narrowMetadataRecord(record)).toBe(record);
  });

  it("returns the object unchanged when the record has nested values", () => {
    const record = { a: { nested: true }, b: [1, 2, 3], c: null };

    expect(narrowMetadataRecord(record)).toBe(record);
  });

  it("returns an empty object for null", () => {
    expect(narrowMetadataRecord(null)).toEqual({});
  });

  it("returns an empty object for undefined", () => {
    expect(narrowMetadataRecord(undefined)).toEqual({});
  });

  it("returns an empty object for an array", () => {
    expect(narrowMetadataRecord([1, 2, 3])).toEqual({});
  });

  it("returns an empty object for an empty array", () => {
    expect(narrowMetadataRecord([])).toEqual({});
  });

  it("returns an empty object for a string primitive", () => {
    expect(narrowMetadataRecord("not a record")).toEqual({});
  });

  it("returns an empty object for a number primitive", () => {
    expect(narrowMetadataRecord(42)).toEqual({});
  });

  it("returns an empty object for a boolean primitive", () => {
    expect(narrowMetadataRecord(true)).toEqual({});
  });
});