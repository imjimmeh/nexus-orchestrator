import { describe, expect, it } from "vitest";
import {
  WorkItemQuerySchema,
  PaginatedWorkItemsSchema,
} from "./work-item-query.schema";

describe("WorkItemQuerySchema", () => {
  it("applies defaults", () => {
    const parsed = WorkItemQuerySchema.parse({});
    expect(parsed).toMatchObject({
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
  });

  it("coerces comma-separated filters into arrays", () => {
    const parsed = WorkItemQuerySchema.parse({ status: "todo,blocked" });
    expect(parsed.status).toEqual(["todo", "blocked"]);
  });

  it("coerces numeric strings and clamps limit to 200", () => {
    const parsed = WorkItemQuerySchema.parse({ limit: "999", offset: "20" });
    expect(parsed.limit).toBe(200);
    expect(parsed.offset).toBe(20);
  });

  it("rejects an unknown sort field", () => {
    expect(() => WorkItemQuerySchema.parse({ sortBy: "secret" })).toThrow();
  });

  it("validates the paginated envelope shape", () => {
    const ok = PaginatedWorkItemsSchema.safeParse({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    expect(ok.success).toBe(true);
  });
});
