import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { OrchestrationService } from "../../../orchestration/orchestration.service";
import { OrchestrationRecordBlockedSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";

type OrchestrationRecordBlockedParams = z.infer<
  typeof OrchestrationRecordBlockedSchema
>;

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

@Injectable()
export class OrchestrationRecordBlockedTool extends KanbanTool<
  OrchestrationRecordBlockedParams,
  unknown
> {
  constructor(private readonly orchestration: OrchestrationService) {
    super("kanban.orchestration_record_blocked", {
      name: "kanban.orchestration_record_blocked",
      description:
        "Record blocked import hydration metadata in kanban orchestration state without changing workflow run status.",
      inputSchema: OrchestrationRecordBlockedSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: OrchestrationRecordBlockedParams,
  ): Promise<unknown> {
    const projectId = resolveProjectIdFromToolContext({
      projectId: params.project_id,
      contextScopeId: context.scopeId,
      toolName: this.getName(),
    });
    const normalizedBlockedReason = normalizeOptionalText(
      params.blocked_reason,
    );
    const childRunId = normalizeOptionalText(params.child_run_id);
    const hydrationChildRunId = normalizeOptionalText(
      params.hydration_child_run_id,
    );
    const runIdForIdempotency = childRunId ?? hydrationChildRunId;

    await this.orchestration.recordImportHydrationBlocked(projectId, {
      blocked_stage: params.blocked_stage,
      blocked_reason: normalizedBlockedReason,
      ready_for_cycle: params.ready_for_cycle,
      hydration_summary: params.hydration_summary,
      child_run_id: childRunId,
      hydration_child_run_id: hydrationChildRunId,
    });

    await this.orchestration.recordCycleDecision(projectId, {
      decision: "blocked",
      reason:
        normalizedBlockedReason ??
        `${params.blocked_stage} blocked orchestration continuation`,
      ...(runIdForIdempotency
        ? {
            idempotencyKey: `imported-hydration-blocked:${projectId}:${runIdForIdempotency}`,
          }
        : {}),
    });

    return {
      ok: true,
      project_id: projectId,
      blocked_stage: params.blocked_stage,
    };
  }
}
