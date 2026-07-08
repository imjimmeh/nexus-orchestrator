import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { WorkItemService } from "../../../work-item/work-item.service";
import { ListWorkItemsSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const LIST_WORK_ITEMS_TOOL_NAME = "kanban.list_work_items";

type ListWorkItemsParams = z.infer<typeof ListWorkItemsSchema>;

interface CompactWorkItemSummary {
  id: string;
  title: string;
  status: string;
  priority?: string;
  linked_run_id?: string;
}

interface ListWorkItemsResult {
  items: CompactWorkItemSummary[];
  total: number;
  limit: number;
  offset: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

@Injectable()
export class ListWorkItemsTool extends KanbanTool<
  ListWorkItemsParams,
  ListWorkItemsResult
> {
  constructor(private readonly workItems: WorkItemService) {
    super(LIST_WORK_ITEMS_TOOL_NAME, {
      name: LIST_WORK_ITEMS_TOOL_NAME,
      description:
        "List work items for a project with optional status filter, text search, and pagination. Returns compact summaries (id, title, status, priority, linked_run_id). Use kanban.work_item(id) for full detail on a specific item.",
      inputSchema: ListWorkItemsSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: ListWorkItemsParams,
  ): Promise<ListWorkItemsResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const allItems = await this.workItems.listWorkItems(projectId);
    const records = allItems.filter(isRecord);

    // Apply status filter
    let filtered = records;
    if (params.status) {
      const allowed = new Set<string>(
        Array.isArray(params.status) ? params.status : [params.status],
      );
      filtered = records.filter((item) => {
        const status = this.getString(item, "status");
        return status ? allowed.has(status) : false;
      });
    }

    // Apply text search on title
    if (params.search && params.search.trim().length > 0) {
      const q = params.search.trim().toLowerCase();
      filtered = filtered.filter((item) => {
        const title = this.getString(item, "title") ?? "";
        return title.toLowerCase().includes(q);
      });
    }

    const total = filtered.length;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const paged = filtered.slice(offset, offset + limit);

    const items: CompactWorkItemSummary[] = paged.map((item) => {
      const summary: CompactWorkItemSummary = {
        id: this.getString(item, "id") ?? "",
        title: this.getString(item, "title") ?? "",
        status: this.getString(item, "status") ?? "",
      };
      const priority = this.getString(item, "priority");
      const linkedRunId =
        this.getString(item, "linked_run_id") ??
        this.getString(item, "linkedRunId");
      if (priority) summary.priority = priority;
      if (linkedRunId) summary.linked_run_id = linkedRunId;
      return summary;
    });

    return { items, total, limit, offset };
  }

  private getString(
    item: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = item[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}
