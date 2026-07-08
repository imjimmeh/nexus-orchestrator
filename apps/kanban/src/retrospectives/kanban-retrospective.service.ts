import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanRetrospectiveRunEntity } from "../database/entities/kanban-retrospective-run.entity";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanRetrospectiveRunRepository } from "../database/repositories/kanban-retrospective-run.repository";
import type { listRetrospectivesSchema } from "./dto/list-retrospectives.dto";
import type { runRetrospectiveSchema } from "./dto/run-retrospective.dto";
import {
  CycleDecisionEventHandler,
  StoredCycleDecisionEvidence,
} from "./events/cycle-decision-event.handler";
import {
  buildCandidateEventId,
  buildCandidatePayload,
  toStableJson,
} from "./kanban-retrospective-candidate.helpers";
import { safeEmitKanbanEvent } from "./kanban-retrospective-event-emitter.helpers";
import { formatUnknownErrorMessage } from "./kanban-retrospective-error.helpers";
import { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";
import {
  toIsoString,
  toKanbanRetrospectiveRunResponse,
} from "./kanban-retrospective-response";
import {
  LEARNING_CANDIDATE_PROPOSED_EVENT,
  type CycleDecisionEventEvidence,
  type KanbanRetrospectiveCompletionTrigger,
  type KanbanRetrospectiveDeltaSnapshot,
  type KanbanRetrospectiveEvidence,
  type KanbanRetrospectiveRunResult,
  type KanbanRetrospectiveSkipReason,
  type KanbanRetrospectiveTriggerType,
} from "./retrospective.types";

type RunRetrospectiveDto = z.output<typeof runRetrospectiveSchema>;
type ListRetrospectivesDto = z.output<typeof listRetrospectivesSchema>;

const RETROSPECTIVE_COOLDOWN_MS = 15 * 60 * 1000;

/** Audit event emitted when the failure-threshold `BypassCooldown`
 * knob suppresses the legacy `cooldown_active` short-circuit. */
export const KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT =
  "kanban.retrospective.cooldown_skipped";

@Injectable()
export class KanbanRetrospectiveService implements OnModuleInit {
  private readonly logger = new Logger(KanbanRetrospectiveService.name);

  constructor(
    @Inject(KanbanRetrospectiveRunRepository)
    private readonly runs: KanbanRetrospectiveRunRepository,
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly evidence: KanbanRetrospectiveEvidenceService,
    @Inject(CoreWorkflowClientService)
    private readonly coreClient: CoreWorkflowClientService,
    private readonly cycleDecisionHandler: CycleDecisionEventHandler,
  ) {}

  /**
   * Initialize the cycle decision event handler when the module starts.
   * This registers the handler with the kanban event emitter.
   */
  onModuleInit(): void {
    this.cycleDecisionHandler.register();
  }

  async runForCompletion(
    trigger: KanbanRetrospectiveCompletionTrigger,
  ): Promise<KanbanRetrospectiveRunResult> {
    return this.executeRun({
      trigger,
      triggerType: "completion_event",
      idempotencyKey: this.buildCompletionIdempotencyKey(trigger),
      replayOfRunId: null,
    });
  }

  async runManualReplay(
    dto: RunRetrospectiveDto,
  ): Promise<KanbanRetrospectiveRunResult> {
    const triggerRevisionMarker =
      dto.trigger_revision_marker ??
      dto.replay_of_run_id ??
      new Date().toISOString();

    return this.executeRun({
      trigger: {
        project_id: dto.project_id,
        orchestration_id: dto.orchestration_id ?? null,
        trigger_revision_marker: triggerRevisionMarker,
        manual_override: dto.manual_override === true,
      },
      triggerType: "manual_replay",
      idempotencyKey: this.buildManualReplayIdempotencyKey(
        dto.project_id,
        triggerRevisionMarker,
      ),
      replayOfRunId: dto.replay_of_run_id ?? null,
    });
  }

  async listRuns(query: ListRetrospectivesDto) {
    const rows = await this.runs.list({
      projectId: query.project_id,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    return rows.map((row) => toKanbanRetrospectiveRunResponse(row));
  }

  async getProjectStatus(projectId: string) {
    const latestRun = await this.runs.findLatestByProject(projectId);

    if (latestRun === null) {
      return {
        project_id: projectId,
        latest_run_timestamp: null,
        trigger_type: null,
        status: null,
        candidate_count: 0,
        skipped_reason: null,
        failure_reason: null,
        idempotency_key: null,
        diagnostics: null,
        delta_snapshot: null,
      };
    }

    return {
      project_id: latestRun.project_id,
      latest_run_timestamp: toIsoString(
        latestRun.completed_at ?? latestRun.started_at,
      ),
      trigger_type: latestRun.trigger_type,
      status: latestRun.status,
      candidate_count: latestRun.candidate_count,
      skipped_reason: latestRun.skip_reason,
      failure_reason: latestRun.failure_reason,
      idempotency_key: latestRun.idempotency_key,
      diagnostics: latestRun.diagnostics_json,
      delta_snapshot: latestRun.delta_snapshot_json,
    };
  }

  private async executeRun(params: {
    trigger: KanbanRetrospectiveCompletionTrigger;
    triggerType: KanbanRetrospectiveTriggerType;
    idempotencyKey: string;
    replayOfRunId: string | null;
    /** Deterministic trigger revision marker for the failure-threshold
     * path (OPEN_QUESTIONS K5). When supplied, used as the idempotency
     * key in place of `idempotencyKey`. Cycle-completion callers leave
     * this unset. */
    triggerRevisionMarker?: string;
    /** True when the failure-threshold trigger's `BypassCooldown`
     * knob (OPEN_QUESTIONS K2) explicitly bypasses the legacy
     * 15-minute cooldown. */
    bypassCooldown?: boolean;
    /** Failure-threshold window-start epoch-seconds, used in the
     * audit-event payload. */
    windowStartEpochSeconds?: number;
  }): Promise<KanbanRetrospectiveRunResult> {
    const { trigger, triggerType, replayOfRunId, bypassCooldown } = params;
    const { windowStartEpochSeconds } = params;
    // K5: the deterministic trigger revision marker (failure-threshold
    // path) takes precedence over the caller-supplied idempotency key
    // so retried emissions within the same window dedupe.
    const idempotencyKey =
      params.triggerRevisionMarker !== undefined &&
      params.triggerRevisionMarker.length > 0
        ? params.triggerRevisionMarker
        : params.idempotencyKey;
    const existingRun = await this.runs.findByIdempotencyKey(idempotencyKey);
    if (existingRun) {
      return {
        status: "skipped",
        reason: "duplicate_trigger",
        runId: existingRun.id,
      };
    }

    const recentCompletedRun = await this.runs.findLatestCompletedByProject(
      trigger.project_id,
    );
    const runOrDuplicate = await this.createRunOrDuplicateSkip({
      trigger,
      triggerType,
      idempotencyKey,
      replayOfRunId,
    });
    if ("runId" in runOrDuplicate) {
      return runOrDuplicate;
    }
    const run = runOrDuplicate;

    if (!trigger.manual_override && this.isCooldownActive(recentCompletedRun)) {
      if (bypassCooldown === true) {
        this.emitCooldownSkipped({
          projectId: trigger.project_id,
          triggerRevisionMarker: trigger.trigger_revision_marker,
          windowStartEpochSeconds: windowStartEpochSeconds ?? null,
        });
      } else {
        return this.skipRun(run.id, "cooldown_active", {
          latest_run_id: recentCompletedRun.id,
        });
      }
    }

    // Collect evidence from the evidence service (database-sourced)
    const collectedEvidence = await this.evidence.collectProjectEvidence(
      trigger.project_id,
    );
    if (collectedEvidence.state !== "ready") {
      return this.skipRun(
        run.id,
        this.getEvidenceSkipReason(collectedEvidence),
        collectedEvidence.state === "insufficient_evidence"
          ? collectedEvidence.diagnostics
          : { state: collectedEvidence.state },
      );
    }

    // Collect additional cycle decision events from the event handler's in-memory store
    const handlerDecisions = this.cycleDecisionHandler.getDecisionsForProject(
      trigger.project_id,
    );

    // Merge handler events with database events
    const allCycleDecisionEvents = this.mergeCycleDecisionEvents(
      collectedEvidence.cycleDecisionEvents,
      handlerDecisions,
    );

    if (this.hasNoDelta(recentCompletedRun, collectedEvidence.deltaSnapshot)) {
      return this.skipRun(run.id, "no_delta", {
        latest_run_id: recentCompletedRun.id,
      });
    }

    try {
      await this.coreClient.emitDomainEventOrThrow({
        eventName: LEARNING_CANDIDATE_PROPOSED_EVENT,
        eventId: buildCandidateEventId(
          run.id,
          collectedEvidence.deltaSnapshot,
        ),
        payload: buildCandidatePayload({
          runId: run.id,
          trigger,
          triggerType,
          deltaSnapshot: collectedEvidence.deltaSnapshot,
          cycleDecisionEvents: allCycleDecisionEvents,
        }),
      });
    } catch (error) {
      await this.runs.markFailed(run.id, {
        failure_reason: "candidate_event_emission_failed",
        diagnostics_json: { error: formatUnknownErrorMessage(error) },
        completed_at: new Date(),
      });
      return {
        status: "failed",
        runId: run.id,
        failureReason: "candidate_event_emission_failed",
      };
    }

    await this.runs.markCompleted(run.id, {
      candidate_count: 1,
      learning_candidate_ids: [],
      delta_snapshot_json: { ...collectedEvidence.deltaSnapshot },
      diagnostics_json: {
        emitted_event: LEARNING_CANDIDATE_PROPOSED_EVENT,
      },
      completed_at: new Date(),
    });

    return {
      status: "completed",
      runId: run.id,
      candidateCount: 1,
    };
  }

  private buildCompletionIdempotencyKey(
    trigger: KanbanRetrospectiveCompletionTrigger,
  ): string {
    return [
      "kanban-retrospective",
      "completion_event",
      trigger.project_id,
      trigger.trigger_revision_marker,
    ].join(":");
  }

  private buildManualReplayIdempotencyKey(
    projectId: string,
    triggerRevisionMarker: string,
  ): string {
    return [
      "kanban-retrospective",
      "manual_replay",
      projectId,
      triggerRevisionMarker,
    ].join(":");
  }

  private isCooldownActive(
    latestRun: { status: string; completed_at: Date | null } | null,
  ): latestRun is { status: "completed"; completed_at: Date } {
    if (latestRun?.status !== "completed" || latestRun.completed_at === null) {
      return false;
    }

    return (
      Date.now() - latestRun.completed_at.getTime() < RETROSPECTIVE_COOLDOWN_MS
    );
  }

  private async createRunOrDuplicateSkip(params: {
    trigger: KanbanRetrospectiveCompletionTrigger;
    triggerType: KanbanRetrospectiveTriggerType;
    idempotencyKey: string;
    replayOfRunId: string | null;
  }): Promise<
    | KanbanRetrospectiveRunEntity
    | Extract<KanbanRetrospectiveRunResult, { status: "skipped" }>
  > {
    const { trigger, triggerType, idempotencyKey, replayOfRunId } = params;
    try {
      return await this.runs.createRun({
        idempotency_key: idempotencyKey,
        project_id: trigger.project_id,
        orchestration_id: trigger.orchestration_id ?? null,
        trigger_type: triggerType,
        trigger_revision_marker: trigger.trigger_revision_marker,
        ...(replayOfRunId === null ? {} : { replay_of_run_id: replayOfRunId }),
        started_at: new Date(),
        diagnostics_json: {
          trigger: {
            cycle_decision: trigger.cycle_decision ?? null,
            details: trigger.trigger_details ?? {},
            manual_override: trigger.manual_override === true,
          },
        },
      });
    } catch (error) {
      if (!this.isIdempotencyUniqueViolation(error)) {
        throw error;
      }

      const racedRun = await this.runs.findByIdempotencyKey(idempotencyKey);
      if (racedRun === null) {
        throw error;
      }

      return {
        status: "skipped",
        reason: "duplicate_trigger",
        runId: racedRun.id,
      };
    }
  }

  private hasNoDelta(
    latestRun: KanbanRetrospectiveRunEntity | null,
    deltaSnapshot: KanbanRetrospectiveDeltaSnapshot,
  ): latestRun is KanbanRetrospectiveRunEntity & {
    delta_snapshot_json: Record<string, unknown>;
  } {
    if (latestRun === null || latestRun.delta_snapshot_json === null) {
      return false;
    }

    return (
      toStableJson(latestRun.delta_snapshot_json) ===
      toStableJson(deltaSnapshot)
    );
  }

  private isIdempotencyUniqueViolation(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const e = error as Record<string, unknown>;
    return (
      e.code === "23505" &&
      typeof e.constraint === "string" &&
      e.constraint.includes("idempotency_key")
    );
  }

  private getEvidenceSkipReason(
    evidence: Exclude<KanbanRetrospectiveEvidence, { state: "ready" }>,
  ): KanbanRetrospectiveSkipReason {
    if (evidence.state === "missing_project") return "missing_project";
    if (evidence.state === "missing_orchestration")
      return "missing_orchestration";
    return "insufficient_evidence";
  }

  /**
   * Emit `kanban.retrospective.cooldown_skipped` when the failure-
   * threshold trigger's `BypassCooldown=true` knob (OPEN_QUESTIONS
   * K2) suppresses the legacy 15-minute `cooldown_active`
   * short-circuit. Best-effort.
   */
  private emitCooldownSkipped(payload: {
    readonly projectId: string;
    readonly triggerRevisionMarker: string;
    readonly windowStartEpochSeconds: number | null;
  }): void {
    const event = {
      event_name: KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT,
      scope_id: payload.projectId,
      bypass_cooldown: true,
      trigger_revision_marker: payload.triggerRevisionMarker,
      window_start_epoch_seconds: payload.windowStartEpochSeconds,
      recorded_at: new Date().toISOString(),
    };
    safeEmitKanbanEvent(
      KANBAN_RETROSPECTIVE_COOLDOWN_SKIPPED_EVENT,
      event,
      this.logger,
    );
  }

  /**
   * Runs a `failure_threshold` retrospective for the given project. This is
   * the public entry point the
   * {@link KanbanRetrospectiveFailureThresholdService} uses to fire a
   * retrospective when the consecutive-failure threshold is met.
   *
   * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
   * EPIC-117 / EPIC-202
   */
  async runForFailureThreshold(input: {
    projectId: string;
    triggerRevisionMarker: string;
    idempotencyKey: string;
    /** Forwarded so the cooldown-bypass audit event can fire when
     * the legacy 15-minute cooldown would otherwise suppress the
     * retrospective (OPEN_QUESTIONS K2). */
    bypassCooldown?: boolean;
    windowStartEpochSeconds?: number;
  }): Promise<KanbanRetrospectiveRunResult> {
    return this.executeRun({
      trigger: {
        project_id: input.projectId,
        orchestration_id: null,
        trigger_revision_marker: input.triggerRevisionMarker,
      },
      triggerType: "failure_threshold",
      idempotencyKey: input.idempotencyKey,
      replayOfRunId: null,
      triggerRevisionMarker: input.triggerRevisionMarker,
      ...(input.bypassCooldown === true
        ? {
            bypassCooldown: true,
            windowStartEpochSeconds: input.windowStartEpochSeconds,
          }
        : {}),
    });
  }

  private async skipRun(
    runId: string,
    reason: KanbanRetrospectiveSkipReason,
    diagnosticsJson: Record<string, unknown>,
  ): Promise<KanbanRetrospectiveRunResult> {
    await this.runs.markSkipped(runId, {
      skip_reason: reason,
      diagnostics_json: diagnosticsJson,
      completed_at: new Date(),
    });
    return { status: "skipped", reason, runId };
  }

  private mergeCycleDecisionEvents(
    dbEvents: CycleDecisionEventEvidence[],
    handlerEvents: StoredCycleDecisionEvidence[],
  ): CycleDecisionEventEvidence[] {
    // StoredCycleDecisionEvidence shares all CycleDecisionEventEvidence fields via CycleDecisionEvidence
    const converted: CycleDecisionEventEvidence[] = handlerEvents.map(
      ({
        decisionType,
        reason,
        recordedAt,
        isSubstantive,
        idempotencyKey,
        provenance,
      }) => ({
        decisionType,
        reason,
        recordedAt,
        isSubstantive,
        idempotencyKey,
        provenance,
      }),
    );

    // Combine and deduplicate by idempotency key (prefer DB events — listed first)
    const seen = new Set<string>();
    return [...dbEvents, ...converted]
      .filter((event) => {
        const key = event.idempotencyKey ?? event.recordedAt;
        return seen.has(key) ? false : (seen.add(key), true);
      })
      .sort(
        (a, b) =>
          new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );
  }
}
