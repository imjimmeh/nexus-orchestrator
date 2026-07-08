import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { ListWorkItemsTool } from "./list-work-items.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

describe("ListWorkItemsTool", () => {
  it("parses omitted project_id and derives it from context.scopeId", async () => {
    const service = {
      listWorkItems: vi.fn().mockResolvedValue([
        { id: "wi-1", title: "Ship", status: "todo" },
        { id: "wi-2", title: "Other", status: "done" },
      ]),
    };
    const tool = new ListWorkItemsTool(service as unknown as WorkItemService);

    expect(
      tool.getDefinition().inputSchema.safeParse({ status: "todo" }).success,
    ).toBe(true);

    const params = tool.getDefinition().inputSchema.parse({ status: "todo" });

    await expect(
      tool.execute({ scopeId: "project-from-context" }, params),
    ).resolves.toEqual({
      items: [{ id: "wi-1", title: "Ship", status: "todo" }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    expect(service.listWorkItems).toHaveBeenCalledWith("project-from-context");
  });
});
