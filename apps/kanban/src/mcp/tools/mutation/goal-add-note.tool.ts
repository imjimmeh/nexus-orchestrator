import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { type ProjectGoalWorklog } from "@nexus/kanban-contracts";
import { z } from "zod";
import { ProjectGoalsService } from "../../../goals/project-goals.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import {
  resolveLinkedRunIdFromToolContext,
  resolveProjectIdFromToolContext,
} from "../shared/tool-context-resolvers";

const GoalAddNoteSchema = ContextualProjectIdSchema.extend({
  goal_id: z.string().min(1),
  note: z.string().min(1),
  work_item_id: z.string().optional(),
  linked_run_id: z.string().optional(),
});

interface GoalAddNoteParams {
  project_id?: string | null;
  goal_id: string;
  note: string;
  work_item_id?: string;
  linked_run_id?: string;
}

@Injectable()
export class GoalAddNoteTool extends KanbanTool<
  GoalAddNoteParams,
  ProjectGoalWorklog
> {
  constructor(private readonly goals: ProjectGoalsService) {
    super("kanban.goal_add_note", {
      name: "kanban.goal_add_note",
      description: "Add a note to a project goal's worklog.",
      inputSchema: GoalAddNoteSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: GoalAddNoteParams,
  ): Promise<ProjectGoalWorklog> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const linkedRunId = resolveLinkedRunIdFromToolContext({
      linkedRunId: params.linked_run_id,
      contextWorkflowRunId: context.workflowRunId,
    });

    return this.goals.createWorklog(projectId, params.goal_id, {
      note: params.note,
      entry_type: "note",
      author_type: "agent",
      work_item_id: params.work_item_id,
      linked_run_id: linkedRunId,
    });
  }
}
