import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import { ExecutionEntity } from './database/entities/execution.entity';
import { ExecutionEventPublisher } from './execution-event.publisher';
import {
  classifyExecutionForReaping,
  resolveContainerLostGraceMs,
  resolveIdleTimeoutMs,
  resolveMaxRuntimeMs,
  resolveProvisionGraceMs,
} from './execution-supervision.helpers';
import type { ReapDecision } from './execution-supervision.helpers.types';
import type { ExecutionFailureReason } from './execution-lifecycle.contracts';
import { AgentEndSignalReader } from './agent-end-signal.reader';
import { JobOutputCompletionSignalReader } from './job-output-completion-signal.reader';
import type { SessionCheckpointMarker, HarnessSessionRef } from '@nexus/core';
import { readLatestMarker } from './checkpoint-marker-reader';
import {
  checkpointSidecarHostPath,
  checkpointSidecarSessionPath,
  resolveCheckpointBaseDir,
} from '../workflow/workflow-session-checkpoint/checkpoint-sidecar-path';
import { readFile } from 'node:fs/promises';
import { isSessionCheckpointResumeEnabled } from '../config/session-checkpoint.config';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';
import { ShutdownStateService } from '../shutdown/shutdown-state.service';

export type {
  ContainerLivenessProbe,
  CheckpointPersistenceDeps,
} from './execution-supervisor.service.types';
import type {
  ContainerLivenessProbe,
  CheckpointPersistenceDeps,
} from './execution-supervisor.service.types';

export const SUPERVISOR_SWEEP_INTERVAL_MS = 30_000;

const REASON_MESSAGES: Record<ExecutionFailureReason, string> = {
  provision_failed: 'Container failed to provision',
  spawn_timeout:
    'Execution did not reach running state within the spawn window',
  never_dispatched: 'Execution was created but never dispatched',
  idle_timeout: 'No activity heartbeat within the idle timeout window',
  max_runtime_exceeded: 'Execution exceeded the maximum allowed runtime',
  container_lost: 'Execution container exited or was lost',
  agent_error: 'Agent reported a terminal error',
  step_failed: 'Step execution failed',
  cancelled_by_user: 'Cancelled by user',
  parent_terminated: 'Parent execution terminated',
  superseded: 'Execution was replaced by a newer attempt for the same job',
};

@Injectable()
export class ExecutionSupervisorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExecutionSupervisorService.name);
  private handle: NodeJS.Timeout | null = null;
  private sweeping = false;
  private readonly idleTimeoutMs = resolveIdleTimeoutMs(
    process.env.EXECUTION_IDLE_TIMEOUT_MS,
  );
  private readonly maxRuntimeMs = resolveMaxRuntimeMs(
    process.env.EXECUTION_MAX_RUNTIME_MS,
  );
  private readonly containerLostGraceMs = resolveContainerLostGraceMs(
    process.env.EXECUTION_CONTAINER_LOST_GRACE_MS,
  );
  private readonly provisionGraceMs = resolveProvisionGraceMs(
    process.env.EXECUTION_PROVISION_GRACE_MS,
  );
  // execution id -> timestamp (ms) when its container was first observed
  // continuously lost. Pruned each sweep so it never outlives the row.
  private readonly containerLostSince = new Map<string, number>();

  constructor(
    private readonly repo: ExecutionRepository,
    private readonly publisher: ExecutionEventPublisher,
    private readonly docker: ContainerLivenessProbe,
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly shutdownState: ShutdownStateService,
    private readonly agentEndSignalReader: AgentEndSignalReader | undefined,
    private readonly checkpointDeps?: CheckpointPersistenceDeps,
    private readonly jobOutputReader?: JobOutputCompletionSignalReader,
  ) {}

  private now(): number {
    return Date.now();
  }

  onModuleInit(): void {
    this.handle = setInterval(() => {
      void this.sweepOnce().catch((error: unknown) => {
        this.logger.error(
          `Supervisor sweep failed: ${(error as Error).message}`,
        );
      });
    }, SUPERVISOR_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  async sweepOnce(): Promise<void> {
    if (this.sweeping) return;
    if (this.lifecycle.isReapingSuspended()) return;
    if (this.shutdownState.isShuttingDown()) {
      this.logger.log('Skipping reap: API is shutting down');
      return;
    }
    this.sweeping = true;
    try {
      const now = this.now();
      const rows = await this.repo.findNonTerminal();

      // Batch: collect all unique run IDs present in this sweep so we can
      // determine which runs have live subagents in a single query per run,
      // avoiding N+1 lookups inside the per-execution loop.
      const runIdsWithLiveSubagents = await this.resolveRunIdsWithLiveSubagents(
        rows
          .map((r) => r.workflow_run_id)
          .filter((id): id is string => id != null),
      );

      const liveIds = new Set<string>();
      for (const row of rows) {
        liveIds.add(row.id);
        if (!row.frozen) {
          await this.processRow(row, now, runIdsWithLiveSubagents);
        }
      }
      this.pruneContainerLostTracking(liveIds);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Processes a single non-frozen execution row within a sweep: probes the
   * container, resolves the agent-end signal when applicable, classifies the
   * result, and dispatches either a reconcile-completed or reap event.
   */
  private async processRow(
    row: ExecutionEntity,
    now: number,
    runIdsWithLiveSubagents: Set<string>,
  ): Promise<void> {
    const containerLost = row.container_id
      ? await this.docker.isContainerLost(row.container_id)
      : false;
    const containerLostForMs = this.trackContainerLost(
      row.id,
      containerLost,
      now,
    );
    const hasLiveChildSubagent =
      row.kind === 'workflow_step' &&
      row.workflow_run_id != null &&
      runIdsWithLiveSubagents.has(row.workflow_run_id);
    const agentEnd = await this.resolveAgentEndSignal(
      row,
      now,
      containerLost,
      hasLiveChildSubagent,
    );
    const durableOutput = await this.resolveDurableOutputSignal(
      row,
      now,
      containerLost,
      hasLiveChildSubagent,
      agentEnd,
    );
    const ownerLease = await this.resolveOwnerLeaseSignal(
      row,
      now,
      containerLost,
      hasLiveChildSubagent,
      agentEnd,
      durableOutput.persisted,
    );
    const result = classifyExecutionForReaping(
      {
        kind: row.kind,
        state: row.state,
        createdAtMs: row.created_at.getTime(),
        lastHeartbeatAtMs: (row.last_heartbeat_at ?? row.created_at).getTime(),
        containerLost,
        containerLostForMs,
        hasLiveChildSubagent,
        agentEndedForMs: agentEnd?.endedForMs ?? null,
        agentEndedOutcome: agentEnd?.outcome,
        durableOutputPersisted: durableOutput.persisted,
        durableOutputQuiescentForMs: durableOutput.quiescentForMs,
        ownerLeaseExpiredForMs: ownerLease.ownerLeaseExpiredForMs,
        latestJobActivityQuiescentForMs:
          ownerLease.latestJobActivityQuiescentForMs,
      },
      now,
      this.idleTimeoutMs,
      this.maxRuntimeMs,
      this.containerLostGraceMs,
      this.provisionGraceMs,
    );
    await this.dispatchDecision(row, result);
  }

  /**
   * Dispatches the lifecycle event implied by the classifier decision:
   * reconcile_completed → completed, reconcile_failed → failed (so on_failure
   * branches run rather than swallowing the failure as a success), reap →
   * checkpoint + reaped.
   */
  private async dispatchDecision(
    row: ExecutionEntity,
    result: ReapDecision | null,
  ): Promise<void> {
    if (result?.kind === 'reconcile_completed') {
      this.logger.log(
        `Supervisor reconciling finished-but-running step execution ${row.id} (run ${row.workflow_run_id ?? '?'}) to completed`,
      );
      await this.publisher.completed(row.id);
    } else if (result?.kind === 'reconcile_failed') {
      this.logger.log(
        `Supervisor reconciling finished-but-running step execution ${row.id} (run ${row.workflow_run_id ?? '?'}) to failed (agent ended in failure)`,
      );
      await this.publisher.failed(row.id, {
        failure_reason: 'agent_error',
        error_message: REASON_MESSAGES.agent_error,
      });
    } else if (result?.kind === 'reap') {
      if (row.kind === 'workflow_step' && this.checkpointDeps) {
        await this.persistCheckpointOnReap(row.id, row, this.checkpointDeps);
      }
      await this.publisher.reaped(row.id, {
        failure_reason: result.reason,
        error_message: REASON_MESSAGES[result.reason],
      });
    }
  }

  /**
   * Queries the agent-end signal ledger for a workflow_step row that is a
   * cheap pre-qualified candidate for reconciliation (running, container alive,
   * no live child subagent). Returns null for all other rows to avoid N+1
   * ledger reads per sweep. Carries the signal `outcome` so the caller can
   * reconcile a failed agent-end as failed rather than completed.
   *
   * The execution row's `context_id` equals the jobId, which is stored as
   * `step_id` on the `workflow.agent.completed` ledger event (emitted by
   * telemetry-gateway-runtime.helpers.ts via `client.stepId = client.jobId ??
   * client.stepId`). They are the same value in this codebase.
   */
  private async resolveAgentEndSignal(
    row: ExecutionEntity,
    now: number,
    containerLost: boolean,
    hasLiveChildSubagent: boolean,
  ): Promise<{ endedForMs: number; outcome: 'success' | 'failure' } | null> {
    if (
      row.kind !== 'workflow_step' ||
      row.state !== 'running' ||
      containerLost ||
      hasLiveChildSubagent ||
      !this.agentEndSignalReader ||
      !row.workflow_run_id ||
      !row.context_id
    ) {
      return null;
    }
    const signal = await this.agentEndSignalReader.findLatest(
      row.workflow_run_id,
      row.context_id,
    );
    return signal
      ? { endedForMs: now - signal.endedAtMs, outcome: signal.outcome }
      : null;
  }

  /**
   * Crash-safe fallback when no `workflow.agent.completed` telemetry signal
   * exists: queries the durable `workflow.agent.output_persisted` ledger signal
   * (emitted by set_job_output) and the job's latest ledger activity, so the
   * supervisor can reconcile a step whose agent produced its terminal output but
   * whose in-process completion was orphaned (e.g. an API restart between the
   * output write and the agent-end emit). Returns `persisted: false` for any row
   * that already has an agent-end signal or is not a quiescence candidate, to
   * avoid an extra ledger read per sweep.
   */
  private async resolveDurableOutputSignal(
    row: ExecutionEntity,
    now: number,
    containerLost: boolean,
    hasLiveChildSubagent: boolean,
    agentEnd: { endedForMs: number; outcome: 'success' | 'failure' } | null,
  ): Promise<{ persisted: boolean; quiescentForMs: number | null }> {
    if (
      agentEnd != null ||
      row.kind !== 'workflow_step' ||
      row.state !== 'running' ||
      containerLost ||
      hasLiveChildSubagent ||
      !this.jobOutputReader ||
      !row.workflow_run_id ||
      !row.context_id
    ) {
      return { persisted: false, quiescentForMs: null };
    }
    const candidate = await this.jobOutputReader.findCompletionCandidate(
      row.workflow_run_id,
      row.context_id,
    );
    if (!candidate) {
      return { persisted: false, quiescentForMs: null };
    }
    return {
      persisted: true,
      quiescentForMs: now - candidate.latestActivityMs,
    };
  }

  private async resolveOwnerLeaseSignal(
    row: ExecutionEntity,
    now: number,
    containerLost: boolean,
    hasLiveChildSubagent: boolean,
    agentEnd: { endedForMs: number; outcome: 'success' | 'failure' } | null,
    durableOutputPersisted: boolean,
  ): Promise<{
    ownerLeaseExpiredForMs: number | null;
    latestJobActivityQuiescentForMs: number | null;
  }> {
    if (
      agentEnd != null ||
      durableOutputPersisted ||
      row.kind !== 'workflow_step' ||
      row.state !== 'running' ||
      containerLost ||
      hasLiveChildSubagent ||
      !this.jobOutputReader ||
      !row.workflow_run_id ||
      !row.context_id ||
      !row.owner_lease_expires_at
    ) {
      return {
        ownerLeaseExpiredForMs: null,
        latestJobActivityQuiescentForMs: null,
      };
    }

    const ownerLeaseExpiredForMs = now - row.owner_lease_expires_at.getTime();
    if (ownerLeaseExpiredForMs < 0) {
      return {
        ownerLeaseExpiredForMs: null,
        latestJobActivityQuiescentForMs: null,
      };
    }

    const activity = await this.jobOutputReader.findLatestJobActivity(
      row.workflow_run_id,
      row.context_id,
    );

    return {
      ownerLeaseExpiredForMs,
      latestJobActivityQuiescentForMs: activity
        ? now - activity.latestActivityMs
        : ownerLeaseExpiredForMs,
    };
  }

  /**
   * Returns the set of workflow run IDs (from the provided list) that currently
   * have at least one non-terminal subagent execution. Queried once per sweep
   * per unique run ID to avoid N+1 database calls inside the per-execution loop.
   */
  private async resolveRunIdsWithLiveSubagents(
    runIds: string[],
  ): Promise<Set<string>> {
    const uniqueRunIds = [...new Set(runIds)];
    const result = new Set<string>();
    await Promise.all(
      uniqueRunIds.map(async (runId) => {
        const subagents = await this.repo.findNonTerminalSubagentsByRun(runId);
        if (subagents.length > 0) {
          result.add(runId);
        }
      }),
    );
    return result;
  }

  private async persistCheckpointOnReap(
    executionId: string,
    row: {
      workflow_run_id?: string | null;
      context_id?: string | null;
      container_tier?: number | null;
    },
    deps: CheckpointPersistenceDeps,
  ): Promise<void> {
    if (!isSessionCheckpointResumeEnabled()) return;

    const { checkpointRepo, sessionHydration } = deps;
    const workflowRunId = row.workflow_run_id;
    const jobId = row.context_id;

    if (!workflowRunId || !jobId) return;

    const sidecarPath = checkpointSidecarHostPath(
      resolveCheckpointBaseDir(),
      workflowRunId,
      jobId,
    );

    let marker: SessionCheckpointMarker | null;
    try {
      marker = await readLatestMarker(sidecarPath);
    } catch (err: unknown) {
      this.logger.warn(
        `Checkpoint read failed for execution ${executionId}: ${(err as Error).message}`,
      );
      return; // best-effort: skip persistence, continue the sweep
    }
    if (!marker) return;

    const sessionRef = await this.resolveReapSessionRef(
      marker,
      workflowRunId,
      jobId,
      sessionHydration,
      row.container_tier ?? undefined,
    );

    try {
      await checkpointRepo.record({
        executionId,
        workflowRunId,
        stepId: jobId,
        engine: marker.engine,
        phase: marker.phase,
        callSeq: marker.callSeq,
        sessionRef,
        resumeNodeId: marker.resumeNodeId ?? null,
        toolName: marker.toolName ?? null,
        idempotencyKey: marker.idempotencyKey ?? null,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist checkpoint for execution ${executionId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Resolves the resume reference to persist on a reap. For engines that write
   * a host session JSONL (pi and claude-code), the freshly reaped v3 tree wins;
   * otherwise the marker's own resume ref (e.g. a claude-code SDK `sessionId`)
   * is preserved. The originating engine is recorded separately on the row.
   */
  private async resolveReapSessionRef(
    marker: SessionCheckpointMarker,
    workflowRunId: string,
    jobId: string,
    sessionHydration: CheckpointPersistenceDeps['sessionHydration'],
    containerTier?: number,
  ): Promise<HarnessSessionRef | null> {
    const sessionRef = marker.sessionRef ?? null;
    if (marker.engine !== 'pi' && marker.engine !== 'claude-code') {
      return sessionRef;
    }
    const treeId = await this.persistHarnessSessionFromHost(
      workflowRunId,
      jobId,
      sessionHydration,
      containerTier,
    );
    return treeId ? { kind: 'pi', treeId } : sessionRef;
  }

  /**
   * Reads the latest session.jsonl from the bind-mounted sidecar directory on
   * the Docker host and persists it into the session store. Returns the fresh
   * treeId, or null when the file is absent, empty, or invalid (best-effort —
   * never throws). Engine-agnostic: both the PI engine and the claude-code
   * engine write a pi-compatible v3 session JSONL during the run.
   *
   * Background: on a SIGKILL the engine's container writes session.jsonl
   * continuously to `CONTAINER_SESSION_PATH` which is bind-mounted from the
   * per-(run, job) sidecar directory. The host copy is always the most recent
   * state, so we read it here rather than relying on the (potentially stale or
   * absent) session tree store entry.
   *
   * @param containerTier - The execution row's container_tier. Forwarded to
   *   {@link ISessionHydrationService.saveSessionFromJsonl} so the stored
   *   session tree carries the correct tier (preventing a silent HEAVY→LIGHT
   *   downgrade on resume).
   */
  private async persistHarnessSessionFromHost(
    workflowRunId: string,
    jobId: string,
    sessionHydration: CheckpointPersistenceDeps['sessionHydration'],
    containerTier?: number,
  ): Promise<string | null> {
    const sessionFilePath = checkpointSidecarSessionPath(
      resolveCheckpointBaseDir(),
      workflowRunId,
      jobId,
    );

    let contents: string;
    try {
      contents = await readFile(sessionFilePath, 'utf-8');
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // File not yet written — expected on first-cycle reap; fall back to bind mount.
        return null;
      }
      this.logger.warn(
        `Harness session.jsonl unavailable at ${sessionFilePath} for run ${workflowRunId}: ${code ?? (error as Error).message}`,
      );
      return null;
    }

    if (!contents.trim()) {
      this.logger.warn(
        `Harness session.jsonl is empty at ${sessionFilePath} for run ${workflowRunId}`,
      );
      return null;
    }

    try {
      const treeId = await sessionHydration.saveSessionFromJsonl(
        contents,
        { workflow_run_id: workflowRunId },
        { containerTier },
      );
      return treeId;
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist harness session from host file for run ${workflowRunId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Records/updates how long an execution's container has been continuously
   * observed lost and returns that duration in ms (null when not currently
   * lost). Resets the moment the container is seen alive again.
   */
  private trackContainerLost(
    executionId: string,
    containerLost: boolean,
    now: number,
  ): number | null {
    if (!containerLost) {
      this.containerLostSince.delete(executionId);
      return null;
    }
    const since = this.containerLostSince.get(executionId) ?? now;
    this.containerLostSince.set(executionId, since);
    return now - since;
  }

  private pruneContainerLostTracking(liveIds: Set<string>): void {
    for (const id of this.containerLostSince.keys()) {
      if (!liveIds.has(id)) {
        this.containerLostSince.delete(id);
      }
    }
  }
}
