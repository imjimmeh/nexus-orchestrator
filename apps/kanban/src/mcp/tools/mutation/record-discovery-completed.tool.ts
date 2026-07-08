import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const RecordDiscoveryCompletedSchema = ContextualProjectIdSchema.extend({
  completed_at: z.iso.datetime().optional(),
});

type RecordDiscoveryCompletedParams = z.infer<
  typeof RecordDiscoveryCompletedSchema
>;

interface RecordDiscoveryCompletedResult {
  project_id: string;
  last_discovery_at: string;
}

const TOOL_NAME = "kanban.record_discovery_completed" as const;

@Injectable()
export class RecordDiscoveryCompletedTool extends KanbanTool<
  RecordDiscoveryCompletedParams,
  RecordDiscoveryCompletedResult
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super(TOOL_NAME, {
      name: TOOL_NAME,
      description:
        "Stamp the project's last_discovery_at field to record that a discovery cycle has completed. Enables the CEO to detect staleness by comparing this timestamp against the current time.",
      inputSchema: RecordDiscoveryCompletedSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: RecordDiscoveryCompletedParams,
  ): Promise<RecordDiscoveryCompletedResult> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    const completedAt = params.completed_at ?? new Date().toISOString();
    await this.orchestration.recordDiscoveryCompleted(projectId, completedAt);

    return { project_id: projectId, last_discovery_at: completedAt };
  }
}
