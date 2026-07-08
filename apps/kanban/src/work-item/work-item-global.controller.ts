import { Controller, Get, Query } from "@nestjs/common";
import { WorkItemService } from "./work-item.service";
import { parseWorkItemQuery } from "./work-item-query";

@Controller("work-items")
export class WorkItemGlobalController {
  constructor(private readonly workItems: WorkItemService) {}

  @Get()
  async listAll(@Query() query: Record<string, unknown>) {
    const params = parseWorkItemQuery(query);
    const projectId =
      typeof query.projectId === "string" && query.projectId.length > 0
        ? query.projectId
        : undefined;
    const data = await this.workItems.queryAllWorkItems({
      ...params,
      projectId,
    });
    return { success: true, data };
  }

  @Get("cost-summary")
  async getCostSummary(@Query() query: Record<string, unknown>) {
    const limit =
      typeof query.limit === "string" && /^\d+$/.test(query.limit)
        ? Math.min(Number(query.limit), 100)
        : 20;
    const projectId =
      typeof query.projectId === "string" && query.projectId.length > 0
        ? query.projectId
        : undefined;
    const data = await this.workItems.getWorkItemCostSummary({
      limit,
      projectId,
    });
    return { success: true, data };
  }

  @Get("cost-estimate/accuracy")
  async getCostEstimateAccuracy() {
    const data = await this.workItems.getCostEstimateAccuracy();
    return { success: true, data };
  }
}
