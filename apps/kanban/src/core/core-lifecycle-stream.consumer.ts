import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  CoreWorkflowEventEnvelopeV1Schema,
  type CoreWorkflowEventEnvelopeV1Shape,
} from "@nexus/core";
import type { Redis } from "ioredis";
import { KANBAN_REDIS_CLIENT } from "./kanban-redis.constants";
import { CoreIntegrationEventRouter } from "./core-integration-event.router";
import { CoreRunProjectionService } from "./core-run-projection.service";
import { KanbanCoreLifecycleCursorRepository } from "../database/repositories/kanban-core-lifecycle-cursor.repository";
import { KanbanCoreLifecycleDeadLetterRepository } from "../database/repositories/kanban-core-lifecycle-dead-letter.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import { OrchestrationRepairLaneService } from "../orchestration/control-plane/orchestration-repair-lane.service";
import { OrchestrationService } from "../orchestration/orchestration.service";
import { ProjectOrchestrationWakeupService } from "../orchestration/project-orchestration-wakeup.service";
import { WorkItemRunLeaseService } from "../work-item/work-item-run-lease";
import { CharterRegenEnqueuer } from "../project/charter-regen.enqueuer";
import { linkWorkItemRunFromLifecycleEvent } from "./core-lifecycle-stream-work-item-link.helpers";
import { replayDeadLetters as replayDeadLettersHelper } from "./core-lifecycle-stream-dead-letter-replay.helpers";
import {
  accrueWorkItemTokenSpend,
  reconcileTerminalWorkflowRun,
  recordWorkItemRunCostAttempt,
  recordTerminalRepairEvidence,
  resolveProjectIdForWorkflowRun,
} from "./core-lifecycle-stream-terminal-projection.helpers";
import {
  classifyTerminalWorkItemRun,
  isRealWorkItemId,
  readPollIntervalMs,
  resolveContinuationTrigger,
  resolveProjectIdFromContext,
  resolveWorkItemIdFromContext,
  shouldStopAfterStaleLink,
  toFields,
  toTerminalWorkflowStatus,
} from "./core-lifecycle-stream.helpers";
import { WorkItemRealtimeGateway } from "../work-item/work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "../work-item/work-item-realtime.publisher";
import { toRecordsWithDependencies } from "../work-item/work-item.service.helpers";
import { OrchestrationWakePolicyService } from "../orchestration/orchestration-wake-policy.service";
import { isProjectDispatchActive } from "../dispatch/project-dispatch-capacity";
import { shouldWakeForTerminalRun } from "../orchestration/orchestration-wake-policy";
import type { TerminalWorkItemRunKind } from "./core-lifecycle-stream.types";

const CORE_LIFECYCLE_STREAM_KEY = "stream:core:lifecycle";
const DEFAULT_CONSUMER_NAME = "core-lifecycle-projection";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
type RedisStreamEntry = [string, string[]];
type PollTimer = ReturnType<typeof setInterval>;

@Injectable()
export class CoreLifecycleStreamConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CoreLifecycleStreamConsumerService.name);
  private readonly pollIntervalMs: number;
  private pollTimer: PollTimer | null = null;
  private pollInFlight = false;

  constructor(
    @Inject(KANBAN_REDIS_CLIENT) private readonly redis: Redis,
    private readonly projectionService: CoreRunProjectionService,
    private readonly cursors: KanbanCoreLifecycleCursorRepository,
    private readonly deadLetters: KanbanCoreLifecycleDeadLetterRepository,
    private readonly orchestrationService: OrchestrationService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemRunCosts: KanbanWorkItemRunCostRepository,
    private readonly repairLane: OrchestrationRepairLaneService,
    @Inject(forwardRef(() => ProjectOrchestrationWakeupService))
    private readonly wakeupService: ProjectOrchestrationWakeupService,
    private readonly leaseService: OrchestrationLeaseService,
    private readonly charterRegen: CharterRegenEnqueuer,
    private readonly integrationEventRouter: CoreIntegrationEventRouter,
    private readonly workItemRunLeaseService: WorkItemRunLeaseService,
    private readonly realtimeGateway: WorkItemRealtimeGateway,
    private readonly realtimePublisher: WorkItemRealtimePublisher,
    private readonly wakePolicyService: OrchestrationWakePolicyService,
  ) {
    this.pollIntervalMs = readPollIntervalMs(DEFAULT_POLL_INTERVAL_MS);
  }

  private get terminalProjectionDeps() {
    return {
      logger: this.logger,
      orchestrationService: this.orchestrationService,
      workItems: this.workItems,
      workItemRunCosts: this.workItemRunCosts,
    };
  }

  private get terminalWorkItemRunDeps() {
    return {
      ...this.terminalProjectionDeps,
      repairLane: this.repairLane,
    };
  }

  async onModuleInit(): Promise<void> {
    await this.processAvailableEvents();
    this.startPolling();
  }

  onModuleDestroy(): void {
    this.stopPolling();
  }

  async processAvailableEvents(consumerName = DEFAULT_CONSUMER_NAME): Promise<{
    processed: number;
    deadLettered: number;
    lastStreamId: string | null;
  }> {
    return this.replayFromCursor(consumerName);
  }

  async replayFromCursor(consumerName = DEFAULT_CONSUMER_NAME): Promise<{
    processed: number;
    deadLettered: number;
    lastStreamId: string | null;
  }> {
    const cursor = await this.cursors.getCursor(consumerName);
    const start = cursor ? `(${cursor.stream_id}` : "-";
    const entries = (await this.redis.xrange(
      CORE_LIFECYCLE_STREAM_KEY,
      start,
      "+",
    )) as RedisStreamEntry[];

    return this.processEntries(entries, consumerName);
  }

  startPolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (!this.pollTimer) {
      return;
    }

    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    try {
      await this.processAvailableEvents();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Core lifecycle stream poll failed: ${reason}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  /**
   * Re-emits stored dead-letter payloads back onto the lifecycle stream and
   * deletes each successfully-republished row. Never touches the forward
   * cursor (distinct from {@link replayFromCursor}), so it can reach rows
   * the cursor has already advanced past. Delegates to
   * {@link replayDeadLettersHelper} for the full contract/logic.
   */
  replayDeadLetters(opts?: {
    proposalIds?: string[];
  }): Promise<{ replayed: number; skipped: number; remaining: number }> {
    return replayDeadLettersHelper(
      {
        logger: this.logger,
        redis: this.redis,
        deadLetters: this.deadLetters,
        streamKey: CORE_LIFECYCLE_STREAM_KEY,
      },
      opts,
    );
  }

  async getDiagnostics(consumerName = DEFAULT_CONSUMER_NAME): Promise<{
    streamKey: string;
    consumerName: string;
    lastStreamId: string | null;
    deadLetterCount: number;
  }> {
    const cursor = await this.cursors.getCursor(consumerName);
    return {
      streamKey: CORE_LIFECYCLE_STREAM_KEY,
      consumerName,
      lastStreamId: cursor?.stream_id ?? null,
      deadLetterCount: await this.deadLetters.countRecent(),
    };
  }

  private async processEntries(
    entries: RedisStreamEntry[],
    consumerName: string,
  ): Promise<{
    processed: number;
    deadLettered: number;
    lastStreamId: string | null;
  }> {
    let processed = 0;
    let deadLettered = 0;
    let lastStreamId: string | null = null;

    for (const [streamId, rawFields] of entries) {
      lastStreamId = streamId;
      const fields = toFields(rawFields);
      try {
        if (this.integrationEventRouter.handles(fields.event_type)) {
          await this.integrationEventRouter.route(
            fields.event_type,
            fields.envelope,
          );
          processed += 1;
        } else {
          const envelope = this.parseEnvelope(fields.envelope);
          if (envelope.event_type.startsWith("core.workflow.run.")) {
            await this.projectionService.recordCoreLifecycleEvent(
              envelope as never,
            );
            await this.linkWorkItemRunFromLifecycleEvent(envelope);
            await this.recordTerminalRunStatus(envelope);
          }

          await this.evaluateContinuationForTerminalRun(envelope);

          processed += 1;
        }
      } catch (error: unknown) {
        deadLettered += 1;
        const reason = error instanceof Error ? error.message : String(error);
        await this.deadLetters.saveDeadLetter({
          stream_key: CORE_LIFECYCLE_STREAM_KEY,
          stream_id: streamId,
          reason,
          payload: fields,
        });
        this.logger.warn(
          `Dead-lettered core lifecycle stream entry ${streamId}: ${reason}`,
        );
      }

      await this.cursors.saveCursor(consumerName, streamId);
    }

    return { processed, deadLettered, lastStreamId };
  }

  /**
   * Test-only seam to exercise {@link processEntries} (private) directly with a
   * synthetic entry batch. Production callers reach it via the cursor replay.
   */
  processEntriesForTest(
    entries: RedisStreamEntry[],
    consumerName: string,
  ): Promise<{
    processed: number;
    deadLettered: number;
    lastStreamId: string | null;
  }> {
    return this.processEntries(entries, consumerName);
  }

  private parseEnvelope(value: string | undefined) {
    if (!value) {
      throw new Error("Malformed core lifecycle event: missing envelope");
    }

    try {
      return CoreWorkflowEventEnvelopeV1Schema.parse(JSON.parse(value));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Malformed core lifecycle event: ${reason}`, {
        cause: error,
      });
    }
  }

  /**
   * Project a non-terminal core workflow run event onto its work item by
   * setting `linked_run_id` and `current_execution_id`. The actual
   * lease-protected link is delegated to
   * `linkWorkItemRunFromLifecycleEvent` so the lease-protocol body lives
   * in a unit-testable helper module.
   */
  private async linkWorkItemRunFromLifecycleEvent(
    envelope: CoreWorkflowEventEnvelopeV1Shape,
  ): Promise<void> {
    if (!envelope.event_type.startsWith("core.workflow.run.")) {
      return;
    }

    if (toTerminalWorkflowStatus(envelope.payload.status)) {
      return;
    }

    await this.maybeHeartbeatCycleLease(envelope);
    await this.maybeMaterializeCharterOnRunStart(envelope);

    await linkWorkItemRunFromLifecycleEvent(
      {
        logger: this.logger,
        workItems: this.workItems,
        workItemRunLeaseService: this.workItemRunLeaseService,
      },
      envelope,
    );

    const projectId = resolveProjectIdFromContext(envelope.payload.context);
    const workItemId = resolveWorkItemIdFromContext(envelope.payload.context);
    if (projectId && isRealWorkItemId(workItemId)) {
      const updated = await this.workItems.recordExecutionStatus({
        project_id: projectId,
        workItemId,
        runId: envelope.payload.run_id,
        status: envelope.payload.status,
      });
      if (updated) {
        await this.broadcastWorkItemRunState(projectId, workItemId);
      }
    }
  }

  private async broadcastWorkItemRunState(
    projectId: string,
    workItemId: string,
  ): Promise<void> {
    const entity = await this.workItems.findByProjectAndId(
      projectId,
      workItemId,
    );
    if (!entity) return;
    const [record] = await toRecordsWithDependencies([entity], this.workItems);
    if (!record) return;
    this.realtimeGateway.broadcastWorkItemUpdated(projectId, record, []);
    void this.realtimePublisher.publish(projectId, record);
  }

  /**
   * Project a terminal core workflow run status onto its work item and
   * eagerly release the work item's run link (`linked_run_id` /
   * `current_execution_id`) so the dispatch WIP slot is freed the moment the
   * run terminates — including cancellations. Previously only the poll-driven
   * reconciliation sweep (`clearTerminalLinkedRun`) cleared the link, but that
   * sweep never revisits items that have already moved to a terminal column
   * (e.g. `done`), so a cancelled/failed run stranded the link forever and the
   * item kept consuming a dispatch slot.
   *
   * `clearRunLinksIfMatches` is keyed on the attached run, so it is idempotent
   * and cannot clobber a superseded run's link. When the link was already
   * cleared (e.g. by the reconciliation sweep) it falls back to a status-only
   * projection so the board still reflects completion/failure immediately. The
   * reconciliation path remains the durable backstop. In-progress items whose
   * link is cleared here are reset to `todo` by the orphan reconciler.
   */
  private async recordTerminalRunStatus(
    envelope: CoreWorkflowEventEnvelopeV1Shape,
  ): Promise<void> {
    if (!envelope.event_type.startsWith("core.workflow.run.")) {
      return;
    }
    if (!toTerminalWorkflowStatus(envelope.payload.status)) {
      return;
    }
    const projectId = resolveProjectIdFromContext(envelope.payload.context);
    const workItemId = resolveWorkItemIdFromContext(envelope.payload.context);
    if (!projectId || !isRealWorkItemId(workItemId)) {
      return;
    }
    const cleared = await this.workItems.clearRunLinksIfMatches(
      projectId,
      workItemId,
      envelope.payload.run_id,
      envelope.payload.status,
    );
    const updated =
      cleared ||
      (await this.workItems.recordExecutionStatus({
        project_id: projectId,
        workItemId,
        runId: envelope.payload.run_id,
        status: envelope.payload.status,
      }));
    if (updated) {
      await this.broadcastWorkItemRunState(projectId, workItemId);
    }
  }

  private async evaluateContinuationForTerminalRun(
    envelope: CoreWorkflowEventEnvelopeV1Shape,
  ): Promise<void> {
    if (!envelope.event_type.startsWith("core.workflow.run.")) {
      return;
    }

    const terminalStatus = toTerminalWorkflowStatus(envelope.payload.status);
    if (!terminalStatus) {
      return;
    }

    const context = envelope.payload.context;
    const projectId = await resolveProjectIdForWorkflowRun(
      this.terminalProjectionDeps,
      envelope.payload.run_id,
      context,
    );
    if (!projectId) {
      return;
    }

    const workflowRunId = envelope.payload.run_id;
    const workItemId = resolveWorkItemIdFromContext(context);
    const workItemRunKind = classifyTerminalWorkItemRun(
      terminalStatus,
      workItemId,
    );

    await accrueWorkItemTokenSpend(this.terminalProjectionDeps, {
      projectId,
      workItemId,
      payload: envelope.payload,
    });

    await recordWorkItemRunCostAttempt(this.terminalProjectionDeps, {
      projectId,
      workflowId: envelope.payload.workflow_id,
      runId: workflowRunId,
      workItemId,
      payload: envelope.payload,
    });

    const reconcileResult = await reconcileTerminalWorkflowRun(
      this.terminalWorkItemRunDeps,
      {
        projectId,
        workflowRunId,
        terminalStatus,
      },
    );

    // Release the cycle lease when the CEO run reaches a terminal state.
    if (envelope.payload.workflow_id === "project_orchestration_cycle_ceo") {
      try {
        await this.leaseService.releaseCycleLease(projectId);
      } catch (error) {
        this.logger.warn(
          `Failed to release cycle lease for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await recordTerminalRepairEvidence(this.terminalWorkItemRunDeps, {
      projectId,
      workflowRunId,
      workItemId,
      terminalStatus,
      isFailedWorkItemRun: workItemRunKind === "failed_work_item",
    });

    if (shouldStopAfterStaleLink(workItemRunKind, reconcileResult?.cleared)) {
      return;
    }

    const trigger = resolveContinuationTrigger(terminalStatus, workItemRunKind);

    const itemStillActive = await this.isWorkItemStillActive(
      projectId,
      workItemId,
      workItemRunKind,
    );
    const policy = await this.wakePolicyService.resolveForProject(projectId);
    const decision = shouldWakeForTerminalRun({
      policy,
      workItemRunKind,
      itemStillActive,
    });

    if (!decision.wake) {
      this.logger.debug(
        `Suppressed orchestration wakeup for project ${projectId} (workItem ${workItemId ?? "n/a"}): ${decision.suppressReason}`,
      );
      return;
    }

    await this.wakeupService
      .requestWakeup({
        projectId,
        reason: trigger,
        source: "core_lifecycle_stream",
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to request orchestration wakeup for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Whether the work item that owned this terminal run is still consuming a
   * dispatch slot. Non-work-item runs are reported inactive (the policy layer
   * ignores `itemStillActive` for them). Reload failures fail open (treated as
   * inactive → wake).
   */
  private async isWorkItemStillActive(
    projectId: string,
    workItemId: string | undefined,
    workItemRunKind: TerminalWorkItemRunKind,
  ): Promise<boolean> {
    if (workItemRunKind === "other" || !isRealWorkItemId(workItemId)) {
      return false;
    }
    try {
      const item = await this.workItems.findByProjectAndId(
        projectId,
        workItemId,
      );
      if (!item) {
        return false;
      }
      return isProjectDispatchActive(item);
    } catch (error) {
      this.logger.warn(
        `Failed to load work item ${workItemId} for wake gate; failing open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async maybeMaterializeCharterOnRunStart(
    envelope: CoreWorkflowEventEnvelopeV1Shape,
  ): Promise<void> {
    if (
      !envelope.event_type.startsWith("core.workflow.run.") ||
      toTerminalWorkflowStatus(envelope.payload.status)
    ) {
      return;
    }
    const context = envelope.payload.context;
    const projectId = context?.scopeId ?? context?.contextId;
    if (!projectId) {
      return;
    }
    try {
      await this.charterRegen.enqueue(projectId);
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue charter regen on run start for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async maybeHeartbeatCycleLease(
    envelope: CoreWorkflowEventEnvelopeV1Shape,
  ): Promise<void> {
    if (
      envelope.payload.workflow_id !== "project_orchestration_cycle_ceo" ||
      envelope.payload.status !== "RUNNING"
    ) {
      return;
    }

    const context = envelope.payload.context;
    const projectId = context?.scopeId ?? context?.contextId;
    if (!projectId) {
      return;
    }

    try {
      await this.leaseService.heartbeatCycleLease(projectId);
    } catch (error) {
      this.logger.warn(
        `Failed to heartbeat cycle lease for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
