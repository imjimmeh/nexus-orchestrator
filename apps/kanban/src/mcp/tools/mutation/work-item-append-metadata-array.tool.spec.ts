import { BadRequestException } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { WorkItemService } from "../../../work-item/work-item.service";
import { WorkItemAppendMetadataArrayTool } from "./work-item-append-metadata-array.tool";

interface MockWorkItems {
  listWorkItems: ReturnType<typeof vi.fn>;
  updateWorkItem: ReturnType<typeof vi.fn>;
}

describe("WorkItemAppendMetadataArrayTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("appends object-shaped QA feedback metadata values", async () => {
    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        {
          id: "work-item-1",
          metadata: {},
        },
      ]),
      updateWorkItem: vi.fn().mockResolvedValue({ id: "work-item-1" }),
    };
    const tool = new WorkItemAppendMetadataArrayTool(
      workItems as unknown as WorkItemService,
    );
    const feedback = {
      decision: "accept",
      feedback: "Looks good.",
      reviewerAgentId: "qa_automation",
    };

    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId: "work-item-1",
      arrayPath: "qaReviews",
      arrayValue: feedback,
    });
    await tool.execute(context, parsed);

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "work-item-1",
      {
        metadata: {
          qaReviews: [feedback],
        },
      },
    );
  });

  it("preserves existing array entries when appending metadata values", async () => {
    const existingReview = {
      decision: "reject",
      feedback: "Needs changes.",
      reviewerAgentId: "qa_automation",
    };
    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        {
          id: "work-item-1",
          metadata: {
            qaReviews: [existingReview],
          },
        },
      ]),
      updateWorkItem: vi.fn().mockResolvedValue({ id: "work-item-1" }),
    };
    const tool = new WorkItemAppendMetadataArrayTool(
      workItems as unknown as WorkItemService,
    );
    const feedback = {
      decision: "accept",
      feedback: "Looks good.",
      reviewerAgentId: "qa_automation",
    };

    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId: "work-item-1",
      arrayPath: "qaReviews",
      arrayValue: feedback,
    });
    await tool.execute(context, parsed);

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "work-item-1",
      {
        metadata: {
          qaReviews: [existingReview, feedback],
        },
      },
    );
  });

  it("rejects appending to existing non-array metadata", async () => {
    const workItems: MockWorkItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        {
          id: "work-item-1",
          metadata: {
            qaReviews: "not-an-array",
          },
        },
      ]),
      updateWorkItem: vi.fn().mockResolvedValue({ id: "work-item-1" }),
    };
    const tool = new WorkItemAppendMetadataArrayTool(
      workItems as unknown as WorkItemService,
    );
    const parsed = tool.getDefinition().inputSchema.parse({
      project_id: "project-1",
      workItemId: "work-item-1",
      arrayPath: "qaReviews",
      arrayValue: "Looks good.",
    });

    await expect(tool.execute(context, parsed)).rejects.toThrow(
      BadRequestException,
    );
    expect(workItems.updateWorkItem).not.toHaveBeenCalled();
  });

  it("requires a metadata value to append", () => {
    const tool = new WorkItemAppendMetadataArrayTool({} as WorkItemService);

    const result = tool.getDefinition().inputSchema.safeParse({
      project_id: "project-1",
      workItemId: "work-item-1",
      arrayPath: "qaReviews",
    });

    expect(result.success).toBe(false);
  });
});
