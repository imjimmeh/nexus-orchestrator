import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import type { StrategicIntentPayload } from "../../../orchestration/strategic/strategic-intent-timeline.types";
import { ContextualProjectIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

const RecordStrategicIntentSchema = ContextualProjectIdSchema.extend({
  focus_initiative_id: z.string().min(1).nullable(),
  rationale: z.string().min(1),
  planned_next_steps: z.array(z.string()).optional().default([]),
  staleness_actions: z.array(z.string()).optional().default([]),
});

type RecordStrategicIntentParams = z.infer<typeof RecordStrategicIntentSchema>;

const TOOL_NAME = "kanban.record_strategic_intent" as const;

@Injectable()
export class RecordStrategicIntentTool extends KanbanTool<
  RecordStrategicIntentParams,
  StrategicIntentPayload
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super(TOOL_NAME, {
      name: TOOL_NAME,
      description:
        "Record the CEO's current strategic intent — which initiative is in focus, why, what the next planned steps are, and what staleness signals prompted this update. Persists a durable entry in the orchestration timeline so future CEO cycles can recall what was previously planned.",
      inputSchema: RecordStrategicIntentSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: RecordStrategicIntentParams,
  ): Promise<StrategicIntentPayload> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });

    return this.orchestration.recordStrategicIntent(projectId, {
      focus_initiative_id: params.focus_initiative_id,
      rationale: params.rationale,
      planned_next_steps: params.planned_next_steps,
      staleness_actions: params.staleness_actions,
    });
  }
}
