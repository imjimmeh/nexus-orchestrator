import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { WorkItemController } from "./work-item.controller";
import type { WorkItemService } from "./work-item.service";

describe("WorkItemController", () => {
  it("exposes a project-scoped feedback resolution route for human decision work items", async () => {
    const submitHumanFeedbackResolution = vi.fn().mockResolvedValue({
      id: "work-item-1",
      project_id: "project-1",
    });
    const service = {
      submitHumanFeedbackResolution,
    } as unknown as WorkItemService;
    const controller = new WorkItemController(service);
    const handler = Reflect.get(
      WorkItemController.prototype,
      "submitHumanFeedbackResolution",
    ) as
      | ((
          projectId: string,
          workItemId: string,
          body: { response?: string; resolved_by?: string },
        ) => Promise<unknown>)
      | undefined;

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      throw new Error("submitHumanFeedbackResolution handler is missing");
    }

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ":workItemId/feedback-resolution",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );

    await expect(
      controller.submitHumanFeedbackResolution("project-1", "work-item-1", {
        response: "Proceed with the staged migration.",
        resolved_by: "user-1",
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        id: "work-item-1",
        project_id: "project-1",
      },
    });
    expect(submitHumanFeedbackResolution).toHaveBeenCalledWith(
      "project-1",
      "work-item-1",
      {
        response: "Proceed with the staged migration.",
        resolvedBy: "user-1",
      },
    );
  });

  it("exposes a project-scoped DELETE route for work item deletion", async () => {
    const deleteWorkItem = vi.fn().mockResolvedValue(undefined);
    const service = {
      deleteWorkItem,
    } as unknown as WorkItemService;
    const controller = new WorkItemController(service);
    const handler = Reflect.get(
      WorkItemController.prototype,
      "deleteWorkItem",
    ) as
      | ((projectId: string, workItemId: string) => Promise<unknown>)
      | undefined;

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      throw new Error("deleteWorkItem handler is missing");
    }

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":workItemId");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.DELETE,
    );

    await expect(
      controller.deleteWorkItem("project-1", "work-item-1"),
    ).resolves.toEqual({ success: true, data: null });
    expect(deleteWorkItem).toHaveBeenCalledWith("project-1", "work-item-1");
  });

  it("list returns the paginated envelope and forces the path projectId", async () => {
    const envelope = { items: [], total: 0, limit: 50, offset: 0 };
    const queryWorkItems = vi.fn().mockResolvedValue(envelope);
    const service = { queryWorkItems } as unknown as WorkItemService;
    const controller = new WorkItemController(service);

    await expect(
      controller.list("project-1", { status: "todo", projectId: "other" }),
    ).resolves.toEqual({ success: true, data: envelope });

    expect(queryWorkItems).toHaveBeenCalledWith("project-1", {
      status: ["todo"],
      sortBy: "updated_at",
      sortDir: "desc",
      limit: 50,
      offset: 0,
    });
  });
});
