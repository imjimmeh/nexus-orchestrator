import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const WorkItemPatchExecutionConfigSchema = ContextualWorkItemIdSchema.extend({
  executionConfigPatch: z.record(z.string(), z.unknown()),
});

interface WorkItemPatchExecutionConfigParams {
  project_id?: string | null;
  workItemId: string;
  executionConfigPatch: Record<string, unknown>;
}

@Injectable()
export class WorkItemPatchExecutionConfigTool extends KanbanTool<
  WorkItemPatchExecutionConfigParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_patch_execution_config", {
      name: "kanban.work_item_patch_execution_config",
      description: "Deep-merge kanban work item execution config.",
      inputSchema: WorkItemPatchExecutionConfigSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: WorkItemPatchExecutionConfigParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const item = await this.getWorkItemRecord(projectId, params.workItemId);
    const executionConfig = this.deepMerge(
      this.asRecord(item.executionConfig) ?? {},
      params.executionConfigPatch,
    );
    return this.workItems.updateWorkItem(projectId, params.workItemId, {
      executionConfig,
    });
  }

  private async getWorkItemRecord(
    project_id: string,
    workItemId: string,
  ): Promise<Record<string, unknown>> {
    const items = await this.workItems.listWorkItems(project_id);
    const item = items.find((c) => c.id === workItemId);
    return this.asRecord(item) ?? {};
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private deepMerge(
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(patch)) {
      const targetValue = result[key];
      result[key] =
        this.asRecord(targetValue) && this.asRecord(value)
          ? this.deepMerge(
              targetValue as Record<string, unknown>,
              value as Record<string, unknown>,
            )
          : value;
    }
    return result;
  }
}
