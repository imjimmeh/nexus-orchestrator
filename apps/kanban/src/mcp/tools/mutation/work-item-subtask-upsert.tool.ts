import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const WorkItemSubtaskUpsertSchema = ContextualWorkItemIdSchema.extend({
  subtask: z.record(z.string(), z.unknown()),
});

interface WorkItemSubtaskUpsertParams {
  project_id?: string | null;
  workItemId: string;
  subtask: Record<string, unknown>;
}

@Injectable()
export class WorkItemSubtaskUpsertTool extends KanbanTool<
  WorkItemSubtaskUpsertParams,
  unknown
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_subtask_upsert", {
      name: "kanban.work_item_subtask_upsert",
      description: "Upsert a subtask on a kanban work item.",
      inputSchema: WorkItemSubtaskUpsertSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: WorkItemSubtaskUpsertParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const item = await this.getWorkItemRecord(projectId, params.workItemId);
    const currentSubtasks = item.subtasks;
    const subtasks: unknown[] = [];
    if (Array.isArray(currentSubtasks)) {
      for (const subtask of currentSubtasks) {
        subtasks.push(subtask);
      }
    }
    const normalized = this.normalizeSubtask(params.subtask);
    const existingIndex = subtasks.findIndex(
      (candidate) =>
        this.asRecord(candidate)?.subtaskId === normalized.subtaskId,
    );
    if (existingIndex >= 0) {
      subtasks[existingIndex] = {
        ...this.asRecord(subtasks[existingIndex]),
        ...normalized,
      };
    } else {
      subtasks.push(normalized);
    }
    return this.workItems.updateWorkItem(projectId, params.workItemId, {
      subtasks,
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

  private optionalString(
    args: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = args[key];
    return typeof value === "string" ? value.trim() : undefined;
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = this.optionalString(args, key);
    if (!value) throw new Error(`${key} is required`);
    return value;
  }

  private normalizeSubtask(
    subtask: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      subtaskId:
        this.optionalString(subtask, "subtask_id") ??
        this.optionalString(subtask, "subtaskId") ??
        this.requireString(subtask, "title"),
      title: this.requireString(subtask, "title"),
      status: this.optionalString(subtask, "status") ?? "todo",
      ...(subtask.order_index !== undefined
        ? { orderIndex: Number(subtask.order_index) }
        : {}),
      ...(Array.isArray(subtask.depends_on_subtask_ids)
        ? { dependsOnSubtaskIds: subtask.depends_on_subtask_ids }
        : {}),
      ...(subtask.metadata !== undefined ? { metadata: subtask.metadata } : {}),
    };
  }
}
