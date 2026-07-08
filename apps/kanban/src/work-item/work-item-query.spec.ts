import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { parseWorkItemQuery } from "./work-item-query";

describe("parseWorkItemQuery", () => {
  it("applies defaults for an empty query", () => {
    expect(parseWorkItemQuery({})).toEqual({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
  });

  it("parses filters and pagination", () => {
    const parsed = parseWorkItemQuery({
      search: "auth",
      status: "todo,blocked",
      limit: "10",
      offset: "20",
      sortBy: "title",
      sortDir: "asc",
    });
    expect(parsed).toMatchObject({
      search: "auth",
      status: ["todo", "blocked"],
      limit: 10,
      offset: 20,
      sortBy: "title",
      sortDir: "asc",
    });
  });

  it("ignores a caller-supplied projectId", () => {
    const parsed = parseWorkItemQuery({ projectId: "p1" });
    expect("projectId" in parsed).toBe(false);
  });

  it("throws BadRequestException on an invalid sort field", () => {
    expect(() => parseWorkItemQuery({ sortBy: "evil" })).toThrow(
      BadRequestException,
    );
  });
});
