import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { RequirePermission } from "../common/require-permission.decorator";
import { WorkItemService } from "./work-item.service";
import { parseWorkItemQuery } from "./work-item-query";
import type { CreateWorkItemInput, WorkItemStatus } from "./work-item.types";

type CreateWorkItemBody = Partial<CreateWorkItemInput>;

type UpdateWorkItemStatusBody = {
  status?: WorkItemStatus;
};

type DispatchWorkItemBody = {
  workflow_id?: string;
  requested_by?: string;
};

type ReviewDecisionBody = {
  decision?: "approve" | "reject";
  workflow_id?: string;
  requested_by?: string;
  feedback?: string;
};

type MergeRequestBody = {
  workflow_id?: string;
  requested_by?: string;
};

type HumanFeedbackResolutionBody = {
  response?: string;
  resolved_by?: string;
};

@Controller("projects/:project_id/work-items")
@UseGuards(KanbanPermissionsGuard)
export class WorkItemController {
  constructor(private readonly workItems: WorkItemService) {}

  @Get()
  @RequirePermission("work_items:read")
  async list(
    @Param("project_id") project_id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const params = parseWorkItemQuery(query);
    const data = await this.workItems.queryWorkItems(project_id, params);
    return { success: true, data };
  }

  @Post()
  @RequirePermission("work_items:write")
  async create(
    @Param("project_id") project_id: string,
    @Body() body: CreateWorkItemBody,
  ) {
    const title = this.requireString(body.title, "title");
    const data = await this.workItems.createWorkItem(project_id, {
      ...body,
      id: body.id,
      title,
    });
    return { success: true, data };
  }

  @Patch(":workItemId/status")
  @RequirePermission("work_items:write")
  async updateStatus(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: UpdateWorkItemStatusBody,
  ) {
    const status = this.requireStatus(body.status);
    const data = await this.workItems.updateStatus(
      project_id,
      workItemId,
      status,
    );
    return { success: true, data };
  }

  @Post(":workItemId/dispatch")
  @RequirePermission("work_items:write")
  async dispatch(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: DispatchWorkItemBody,
  ) {
    const workflowId = this.requireString(body.workflow_id, "workflow_id");
    const data = await this.workItems.dispatchWorkItem(project_id, workItemId, {
      workflowId,
      requestedBy: body.requested_by,
    });
    return { success: true, data };
  }

  @Post(":workItemId/qa-decision")
  @RequirePermission("work_items:write")
  async submitReviewDecision(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: ReviewDecisionBody,
  ) {
    const decision = body.decision;
    if (!decision) {
      throw new BadRequestException("decision is required");
    }

    const workflowId = this.requireString(body.workflow_id, "workflow_id");
    const data = await this.workItems.submitReviewDecision(
      project_id,
      workItemId,
      {
        decision,
        workflowId,
        requestedBy: body.requested_by,
        feedback: body.feedback,
      },
    );
    return { success: true, data };
  }

  @Post(":workItemId/merge")
  @RequirePermission("work_items:write")
  async requestMerge(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: MergeRequestBody,
  ) {
    const workflowId = this.requireString(body.workflow_id, "workflow_id");
    const data = await this.workItems.requestMerge(project_id, workItemId, {
      workflowId,
      requestedBy: body.requested_by,
    });
    return { success: true, data };
  }

  @Post(":workItemId/feedback-resolution")
  @RequirePermission("work_items:write")
  async submitHumanFeedbackResolution(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: HumanFeedbackResolutionBody,
  ) {
    const response = this.requireString(body.response, "response");
    const data = await this.workItems.submitHumanFeedbackResolution(
      project_id,
      workItemId,
      {
        response,
        resolvedBy: body.resolved_by,
      },
    );
    return { success: true, data };
  }

  @Patch(":workItemId")
  @RequirePermission("work_items:write")
  async updateWorkItem(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: unknown,
  ) {
    const data = await this.workItems.updateWorkItem(
      project_id,
      workItemId,
      body,
    );
    return { success: true, data };
  }

  @Delete(":workItemId")
  @RequirePermission("work_items:write")
  async deleteWorkItem(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
  ) {
    await this.workItems.deleteWorkItem(project_id, workItemId);
    return { success: true, data: null };
  }

  @Post(":workItemId/restart")
  @RequirePermission("work_items:write")
  async restartExecution(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
  ) {
    const data = await this.workItems.restartExecution(project_id, workItemId);
    return { success: true, data };
  }

  @Get(":workItemId/executions")
  @RequirePermission("work_items:read")
  async getExecutions(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
  ) {
    const data = await this.workItems.getExecutions(project_id, workItemId);
    return { success: true, data };
  }

  @Get(":workItemId/execution-config")
  @RequirePermission("work_items:read")
  async getExecutionConfig(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
  ) {
    const data = await this.workItems.getExecutionConfig(
      project_id,
      workItemId,
    );
    return { success: true, data };
  }

  @Patch(":workItemId/execution-config")
  @RequirePermission("work_items:write")
  async upsertExecutionConfig(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: unknown,
  ) {
    const data = await this.workItems.upsertExecutionConfig(
      project_id,
      workItemId,
      body,
    );
    return { success: true, data };
  }

  @Get("automation-triggers")
  @RequirePermission("work_items:read")
  async getAutomationTriggers(@Param("project_id") project_id: string) {
    const data = await this.workItems.getActiveAutomationStatuses(project_id);
    return { success: true, data };
  }

  @Get("realtime-config")
  @RequirePermission("work_items:read")
  getRealtimeConfig(
    @Param("project_id") _project_id: string,
    @Req() req: Request,
  ) {
    return {
      success: true,
      data: {
        wsUrl: this.getKanbanWsUrl(req),
        namespace: "/kanban",
      },
    };
  }

  private getKanbanWsUrl(req: Request): string {
    if (process.env.KANBAN_PUBLIC_WS_URL) {
      return process.env.KANBAN_PUBLIC_WS_URL;
    }

    const host = req.hostname || "127.0.0.1";
    const port = process.env.KANBAN_PORT ?? "3012";
    const protocol = req.secure ? "https" : "http";
    return `${protocol}://${host}:${port}`;
  }

  private requireStatus(status: WorkItemStatus | undefined): WorkItemStatus {
    if (!status) {
      throw new BadRequestException("status is required");
    }

    return status;
  }

  private requireString(value: string | undefined, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }
}
