import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { z } from "zod";
import { CoreWorkflowClientService } from "../../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../../retrospectives/kanban-retrospective-evidence.service";
import {
  LEARNING_CANDIDATE_PROPOSED_EVENT,
  RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
} from "../../../core/events/domain-events";
import type { CycleMetadata } from "../../../retrospectives/types/cycle-decision.types";
import { DecisionType } from "../../../retrospectives/types/cycle-decision.types";
import { OrchestrationRecordCycleDecisionTool } from "./orchestration-record-cycle-decision.tool";
import type { BoardStateSummary as EventBoardStateSummary } from "../../../retrospectives/types/cycle-decision.types";
import { extractBoardStateSummary } from "../../../retrospectives/cycle-decision-metadata";
import { BoardStateService } from "../../../services/board-state.service";
import type { BoardStateSnapshotResult } from "../../../services/board-state.types";

export const CompleteOrchestrationCycleDecisionInputSchema = z
  .object({
    project_id: z
      .preprocess(
        (val: unknown) => (typeof val === "string" ? val.trim() : val),
        z.string().min(1),
      )
      .optional(),
    decision: z.enum(["repeat", "pause", "complete", "blocked"]).optional(),
    reason: z.preprocess(
      (val: unknown) => (typeof val === "string" ? val.trim() : val),
      z.string().min(1),
    ),
    idempotency_key: z
      .preprocess(
        (val: unknown) => (typeof val === "string" ? val.trim() : val),
        z.string().min(1),
      )
      .optional(),
    autonomous_default: z.boolean().optional(),
    ready_work_remaining: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.decision !== undefined && data.autonomous_default === true) {
        return false;
      }
      return true;
    },
    {
      message:
        "autonomous_default must not be set when decision is provided explicitly",
    },
  )
  .refine(
    (data) => {
      if (data.decision === undefined) {
        return (
          data.autonomous_default === true && data.ready_work_remaining === true
        );
      }
      return true;
    },
    {
      message:
        "Omitted decision requires autonomous_default: true and ready_work_remaining: true",
    },
  );

type CompleteOrchestrationCycleDecisionParams = z.infer<
  typeof CompleteOrchestrationCycleDecisionInputSchema
>;

type CycleDecisionToolResult = {
  ok?: unknown;
  project_id?: unknown;
  decision?: unknown;
  reason?: unknown;
  linked_run_id?: unknown;
  persisted?: unknown;
  duplicate?: unknown;
  skipped?: unknown;
};

/**
 * Result type for the complete_orchestration_cycle_decision tool execution.
 */
type CompleteOrchestrationCycleDecisionResult = {
  ok: boolean;
  project_id: string;
  decision?: unknown;
  reason?: unknown;
  linked_run_id?: string;
  persisted?: unknown;
  duplicate?: unknown;
  output_written: boolean;
  output_fields: string[];
  next_action: string;
  step_complete_called: boolean;
  /** Indicates whether this cycle decision is substantive (non-trivial).
   * A decision is substantive if it's 'blocked', 'complete', 'continue',
   * or 'repeat' with board mutations detected.
   */
  isSubstantive: boolean;
};

@Injectable()
export class CompleteOrchestrationCycleDecisionTool extends KanbanTool<
  CompleteOrchestrationCycleDecisionParams,
  CompleteOrchestrationCycleDecisionResult
> {
  constructor(
    private readonly recordCycleDecisionTool: OrchestrationRecordCycleDecisionTool,
    private readonly coreWorkflowClient: CoreWorkflowClientService,
    @Inject(KanbanRetrospectiveEvidenceService)
    private readonly evidenceService: KanbanRetrospectiveEvidenceService,
    private readonly boardStateService: BoardStateService,
  ) {
    super("kanban.complete_orchestration_cycle_decision", {
      name: "kanban.complete_orchestration_cycle_decision",
      description:
        "Record the final orchestration cycle decision and mirror it into workflow job output for the current execution.",
      inputSchema: CompleteOrchestrationCycleDecisionInputSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    context: InternalToolExecutionContext,
    params: CompleteOrchestrationCycleDecisionParams,
  ): Promise<CompleteOrchestrationCycleDecisionResult> {
    const runtimeContext = this.requireRuntimeJobContext(context);
    const resolvedParams = this.resolveProjectId(context, params);
    const decisionResult = this.asCycleDecisionResult(
      await this.recordCycleDecisionTool.execute(context, resolvedParams),
    );
    const decision = this.requireStringField(
      decisionResult.decision,
      "decision",
    );
    const reason = this.requireStringField(decisionResult.reason, "reason");
    const persisted = decisionResult.persisted === true;
    const duplicate = decisionResult.duplicate === true;

    await this.coreWorkflowClient.setWorkflowJobOutput({
      workflowRunId: runtimeContext.workflowRunId,
      jobId: runtimeContext.jobId,
      data: {
        decision,
        decision_reason: reason,
        linked_run_id: runtimeContext.workflowRunId,
      },
    });

    let isSubstantive = false;

    if (persisted && !duplicate) {
      // Store current board state snapshot before decision
      const boardSnapshot =
        await this.boardStateService.createBoardStateSnapshot(
          resolvedParams.project_id,
          resolvedParams.idempotency_key ?? "",
        );

      // Detect board mutation for repeat decisions
      const boardMutation = await this.boardStateService.detectBoardMutation(
        resolvedParams.project_id,
        resolvedParams.idempotency_key ?? "",
      );

      // Emit kanban.retrospective_cycle_decision_recorded event:
      // - Always emit for 'blocked', 'complete', or 'continue' (substantive)
      // - Only emit for 'repeat' if board mutation detected (non-trivial repeat)
      const decisionNormalized = decision.toLowerCase();
      isSubstantive =
        decisionNormalized === "blocked" ||
        decisionNormalized === "complete" ||
        decisionNormalized === "continue" ||
        (decisionNormalized === "repeat" && boardMutation.hasMutations);

      if (isSubstantive) {
        await this.emitRetrospectiveCycleDecisionRecorded({
          projectId: resolvedParams.project_id,
          decision,
          reason,
          workflowRunId: runtimeContext.workflowRunId,
          jobId: runtimeContext.jobId,
          idempotencyKey: params.idempotency_key,
          boardMutationDetected: boardMutation.hasMutations,
          boardSnapshot,
        });
      }
    }

    return {
      ...decisionResult,
      ok: true,
      project_id: resolvedParams.project_id,
      linked_run_id: runtimeContext.workflowRunId,
      output_written: true,
      output_fields: ["decision", "decision_reason", "linked_run_id"],
      next_action: "call_step_complete",
      step_complete_called: false,
      isSubstantive,
    };
  }

  private resolveProjectId(
    context: InternalToolExecutionContext,
    params: CompleteOrchestrationCycleDecisionParams,
  ): CompleteOrchestrationCycleDecisionParams & { project_id: string } {
    if (params.project_id) {
      return params as CompleteOrchestrationCycleDecisionParams & {
        project_id: string;
      };
    }

    const scopeId = this.trimOptional(context.scopeId);
    if (scopeId) {
      return { ...params, project_id: scopeId };
    }

    throw new BadRequestException(
      "kanban.complete_orchestration_cycle_decision requires project_id. " +
        "Provide project_id in the tool arguments or ensure the call context carries a scopeId.",
    );
  }

  private requireRuntimeJobContext(context: InternalToolExecutionContext): {
    workflowRunId: string;
    jobId: string;
  } {
    const workflowRunId = this.trimOptional(context.workflowRunId);
    const jobId = this.trimOptional(context.jobId);
    if (!workflowRunId || !jobId) {
      throw new BadRequestException(
        "kanban.complete_orchestration_cycle_decision requires workflow run and job context from the runtime.",
      );
    }
    return { workflowRunId, jobId };
  }

  private asCycleDecisionResult(value: unknown): CycleDecisionToolResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(
        "Cycle decision tool returned an invalid result.",
      );
    }
    return value;
  }

  private requireStringField(value: unknown, field: string): string {
    const normalized = this.trimOptional(value);
    if (!normalized) {
      throw new BadRequestException(
        `Cycle decision tool returned an invalid ${field}.`,
      );
    }
    return normalized;
  }

  private trimOptional(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private async emitRetrospectiveCycleDecisionRecorded(params: {
    projectId: string;
    decision: string;
    reason: string;
    workflowRunId: string;
    jobId: string;
    idempotencyKey?: string;
    boardMutationDetected: boolean;
    boardSnapshot?: BoardStateSnapshotResult;
  }): Promise<void> {
    const evidence = await this.evidenceService.collectProjectEvidence(
      params.projectId,
    );

    // Get proper board state summary for metadata extraction
    const serviceBoardStateSummary =
      await this.boardStateService.getBoardStateSummary(params.projectId);

    // Convert to event board state summary format
    const boardStateSummary: EventBoardStateSummary = extractBoardStateSummary(
      serviceBoardStateSummary,
    );

    let workItemCountsSnapshot: {
      total: number;
      byStatus: Record<string, number>;
    } | null = null;
    if (evidence.state === "ready") {
      workItemCountsSnapshot = {
        total: evidence.deltaSnapshot.workItems.total,
        byStatus: { ...evidence.deltaSnapshot.workItems.countsByStatus },
      };
    }

    // Determine the actual DecisionType enum value
    const normalizedDecision = params.decision.toLowerCase();
    let decisionType: DecisionType;
    if (normalizedDecision === "complete") {
      decisionType = DecisionType.COMPLETE;
    } else if (normalizedDecision === "blocked") {
      decisionType = DecisionType.BLOCKED;
    } else {
      decisionType = DecisionType.REPEAT;
    }

    // Check if this is a substantive decision:
    // - Always substantive for blocked or complete
    // - Only substantive for repeat if board mutation was detected
    const isSubstantive =
      decisionType === DecisionType.BLOCKED ||
      decisionType === DecisionType.COMPLETE ||
      (decisionType === DecisionType.REPEAT && params.boardMutationDetected);

    if (!isSubstantive) {
      // Skip event emission for trivial repeats
      return;
    }

    const cycleMetadata: CycleMetadata = {
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      decisionSource: "orchestration_cycle",
    };

    // Build the event payload with the board state summary
    const eventPayload = {
      eventName: RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      projectId: params.projectId,
      decision: decisionType,
      reasoning: params.reason,
      idempotencyKey: params.idempotencyKey ?? null,
      boardStateSummary,
      timestamp: new Date().toISOString(),
      cycleMetadata,
    };

    await this.coreWorkflowClient.emitDomainEvent({
      eventName: RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT,
      eventId: this.buildEventId(params),
      payload: eventPayload,
    });

    // Emit learning.candidate.proposed.v1 for substantive decisions
    await this.emitLearningCandidateProposed({
      projectId: params.projectId,
      decision: params.decision,
      reason: params.reason,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      idempotencyKey: params.idempotencyKey,
      workItemCountsSnapshot,
    });
  }

  private async emitLearningCandidateProposed(params: {
    projectId: string;
    decision: string;
    reason: string;
    workflowRunId: string;
    jobId: string;
    idempotencyKey?: string;
    workItemCountsSnapshot: {
      total: number;
      byStatus: Record<string, number>;
    } | null;
  }): Promise<void> {
    const doneCount = params.workItemCountsSnapshot?.byStatus["done"] ?? 0;
    const blockedCount =
      params.workItemCountsSnapshot?.byStatus["blocked"] ?? 0;

    const lesson = `Kanban project ${params.projectId} completed an orchestration cycle with ${doneCount} done items, ${blockedCount} blocked items, and cycle decision ${params.decision}.`;

    const deltaSnapshot = {
      workItems: {
        total: params.workItemCountsSnapshot?.total ?? 0,
        countsByStatus: params.workItemCountsSnapshot?.byStatus ?? {},
      },
    };

    const payload = {
      event_name: LEARNING_CANDIDATE_PROPOSED_EVENT,
      source_service: "kanban",
      scope_type: "kanban_project",
      scope_id: params.projectId,
      lesson,
      evidence: [
        {
          kind: "kanban_retrospective_delta",
          id: `cycle-decision-${params.workflowRunId}-${Date.now()}`,
          summary: lesson,
          data: deltaSnapshot,
        },
      ],
      confidence: 0.6,
      tags: ["kanban", "retrospective", "orchestration-cycle"],
      provenance: {
        project_id: params.projectId,
        workflow_run_id: params.workflowRunId,
        job_id: params.jobId,
        idempotency_key: params.idempotencyKey ?? null,
        decision_source: "orchestration_cycle",
        cycle_decision: params.decision,
      },
    };

    await this.coreWorkflowClient.emitDomainEvent({
      eventName: LEARNING_CANDIDATE_PROPOSED_EVENT,
      eventId: `kanban:learning_candidate:${params.projectId}:${params.workflowRunId}:${Date.now()}`,
      payload,
    });
  }

  private normalizeDecisionType(decision: string): DecisionType {
    const normalized = decision.toLowerCase();
    if (normalized === "complete") {
      return DecisionType.COMPLETE;
    }
    if (normalized === "blocked") {
      return DecisionType.BLOCKED;
    }
    return DecisionType.REPEAT;
  }

  private buildEventId(params: {
    projectId: string;
    decision: string;
    workflowRunId: string;
  }): string {
    return `kanban:retrospective_cycle_decision:${params.projectId}:${params.workflowRunId}:${Date.now()}`;
  }
}
