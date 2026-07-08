import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

interface WorkItemAppendMetadataArrayParams {
  project_id?: string | null;
  workItemId: string;
  arrayPath: string;
  arrayValue: unknown;
}

@Injectable()
export class WorkItemAppendMetadataArrayTool extends KanbanTool<
  WorkItemAppendMetadataArrayParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_append_metadata_array", {
      name: "kanban.work_item_append_metadata_array",
      description: "Append a value to a metadata array on a kanban work item.",
      inputSchema: ContextualWorkItemIdSchema.extend({
        arrayPath: z.string().min(1),
        arrayValue: z.unknown(),
      }),
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: WorkItemAppendMetadataArrayParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const item = await this.getWorkItemRecord(projectId, params.workItemId);
    const metadata = this.deepMerge({}, this.asRecord(item.metadata) ?? {});
    const existing = metadata[params.arrayPath];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new BadRequestException(
        `Metadata path "${params.arrayPath}" must be an array before appending`,
      );
    }
    const existingItems: unknown[] = Array.isArray(existing) ? existing : [];
    metadata[params.arrayPath] = [...existingItems, params.arrayValue];
    return this.workItems.updateWorkItem(projectId, params.workItemId, {
      metadata,
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
