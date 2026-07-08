import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from "@nestjs/common";
import { DispatchService } from "./dispatch.service";

const DEFAULT_SELECTED_CONTEXT_WORKFLOW_ID = "work_item_in_progress_default";

type DispatchReadyBody = {
  workflow_id?: string;
  requested_by?: string;
  limit?: number;
  max_concurrent_per_agent?: number;
  reconcile_run_status?: boolean;
};

type DispatchSelectedContextItemsBody = {
  context_ids?: string[];
  workflow_id?: string;
  requested_by?: string;
  max_concurrent_per_agent?: number;
};

@Controller("projects/:project_id/dispatch")
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Post("ready-work-items")
  async dispatchReadyWorkItems(
    @Param("project_id") project_id: string,
    @Body() body: DispatchReadyBody,
  ) {
    const workflowId = this.requireString(body.workflow_id, "workflow_id");
    const data = await this.dispatch.dispatchReadyWorkItems({
      project_id,
      workflowId,
      requestedBy: body.requested_by,
      limit: body.limit,
      maxConcurrentPerAgent: body.max_concurrent_per_agent,
      reconcileRunStatus: body.reconcile_run_status,
    });
    return { success: true, data };
  }

  @Post("selected-context-items")
  async dispatchSelectedContextItems(
    @Param("project_id") project_id: string,
    @Body() body: DispatchSelectedContextItemsBody,
  ) {
    const contextIds = this.requireContextIds(body.context_ids);
    const maxConcurrentPerAgent = this.optionalPositiveInteger(
      body.max_concurrent_per_agent,
      "max_concurrent_per_agent",
    );
    const workflowId =
      body.workflow_id?.trim() || DEFAULT_SELECTED_CONTEXT_WORKFLOW_ID;
    const data = await this.dispatch.dispatchSelectedWorkItems({
      projectId: project_id,
      workItemIds: contextIds,
      workflowId,
      requestedBy: body.requested_by,
      maxConcurrentPerAgent,
    });

    return { success: true, data };
  }

  private requireString(value: string | undefined, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private requireContextIds(value: string[] | undefined): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException("context_ids must be an array");
    }

    const contextIds = value.map((contextId) =>
      typeof contextId === "string" ? contextId.trim() : "",
    );
    if (contextIds.some((contextId) => contextId.length === 0)) {
      throw new BadRequestException(
        "context_ids must contain only non-empty strings",
      );
    }

    return contextIds;
  }

  private optionalPositiveInteger(
    value: number | undefined,
    field: string,
  ): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    return value;
  }
}
