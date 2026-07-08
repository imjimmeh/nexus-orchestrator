import { Injectable } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { WorkItemService } from "../../../work-item/work-item.service";

const UMBRELLA_RESOLVED_STATUS = "done";

interface ResolveUmbrellaParentParams {
  project_id?: string | null;
  workItemId: string;
}

type ResolveResult =
  | { resolved: false; reason: string }
  | { resolved: true; parentId: string };

@Injectable()
export class WorkItemResolveUmbrellaParentTool extends KanbanTool<
  ResolveUmbrellaParentParams,
  ResolveResult
> {
  constructor(private readonly workItems: WorkItemService) {
    super("kanban.work_item_resolve_umbrella_parent", {
      name: "kanban.work_item_resolve_umbrella_parent",
      description:
        "If the given completed child's umbrella parent has all children done, transition the parent to done.",
      inputSchema: ContextualWorkItemIdSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: ResolveUmbrellaParentParams,
  ): Promise<ResolveResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const all = await this.workItems.listWorkItems(projectId);
    const byId = new Map(all.map((item) => [item.id, item]));

    const child = byId.get(params.workItemId);
    const parentId = child?.parentWorkItemId ?? undefined;
    if (!parentId) {
      return { resolved: false, reason: "no_parent" };
    }

    const parent = byId.get(parentId);
    if (!parent) {
      return { resolved: false, reason: "parent_not_found" };
    }
    if (parent.status === UMBRELLA_RESOLVED_STATUS) {
      return { resolved: false, reason: "already_resolved" };
    }

    const childIds = await this.workItems.findChildIds(parentId);
    if (childIds.length === 0) {
      return { resolved: false, reason: "no_children" };
    }

    const allDone = childIds.every(
      (id) => byId.get(id)?.status === UMBRELLA_RESOLVED_STATUS,
    );
    if (!allDone) {
      return { resolved: false, reason: "children_pending" };
    }

    await this.workItems.updateStatus(
      projectId,
      parentId,
      UMBRELLA_RESOLVED_STATUS,
    );
    return { resolved: true, parentId };
  }
}
