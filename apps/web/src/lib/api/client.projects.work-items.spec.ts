// apps/web/src/lib/api/client.projects.work-items.spec.ts
import { describe, expect, it, vi } from "vitest";
import { projectApiMethods } from "./client.projects";

function bindGet() {
  const get = vi.fn(async (_url: string) => ({
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
  }));
  const ctx = { get } as never;
  return { get, ctx };
}

describe("paginated work item client methods", () => {
  it("builds a querystring for getAllWorkItems", async () => {
    const { get, ctx } = bindGet();
    await projectApiMethods.getAllWorkItems.call(ctx, {
      search: "auth",
      status: "todo",
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
    const url = get.mock.calls[0][0] as string;
    expect(url.startsWith("/work-items?")).toBe(true);
    expect(url).toContain("search=auth");
    expect(url).toContain("status=todo");
    expect(url).toContain("sortBy=updated_at");
  });

  it("omits the querystring when no query is given", async () => {
    const { get, ctx } = bindGet();
    await projectApiMethods.getProjectWorkItems.call(ctx, "p1");
    expect(get.mock.calls[0][0]).toBe("/projects/p1/work-items");
  });

  it("fetches a work item cost estimate by project and work item", async () => {
    const { get, ctx } = bindGet();
    await projectApiMethods.getWorkItemCostEstimate.call(ctx, "p1", "wi1");
    expect(get.mock.calls[0][0]).toBe("/work-items/p1/wi1/cost-estimate");
  });
});
