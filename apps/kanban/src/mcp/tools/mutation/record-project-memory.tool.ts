import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import {
  ProjectMemoryCategorySchema,
  type ProjectMemoryCategory,
} from "@nexus/kanban-contracts";
import { z } from "zod";
import { ProjectMemorySummaryService } from "../../../project/project-memory-summary.service";

const RecordProjectMemorySchema = z.object({
  scope_id: z.string().min(1),
  category: ProjectMemoryCategorySchema,
  content: z.string().min(1),
  memory_type: z.enum(["preference", "fact", "history"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type RecordProjectMemoryParams = z.infer<typeof RecordProjectMemorySchema>;

const TOOL_NAME = "kanban.record_project_memory" as const;

@Injectable()
export class RecordProjectMemoryTool extends KanbanTool<
  RecordProjectMemoryParams,
  { id: string; category: ProjectMemoryCategory }
> {
  constructor(private readonly memories: ProjectMemorySummaryService) {
    super(TOOL_NAME, {
      name: TOOL_NAME,
      description:
        "Persist a categorized piece of project intent (requirement, constraint, decision, etc.) as a project-scoped memory segment.",
      inputSchema: RecordProjectMemorySchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    _context: InternalToolExecutionContext,
    params: RecordProjectMemoryParams,
  ): Promise<{ id: string; category: ProjectMemoryCategory }> {
    const segment = await this.memories.createProjectMemory(params.scope_id, {
      category: params.category,
      content: params.content,
      source: "onboarding_chat",
      memoryType: params.memory_type,
      confidence: params.confidence,
    });
    return { id: segment.id, category: params.category };
  }
}
