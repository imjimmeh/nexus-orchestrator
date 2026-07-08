import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import { RetrospectiveGateService } from './retrospective-gate.service';
import { RetrospectiveDrainService } from './retrospective-drain.service';
import { resolveScopeId } from './resolve-scope-id.helper';
import { resolveRetrospectiveEnabled } from './retrospective-enabled.settings';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { ChatSessionStatus } from '@nexus/core';
import type { ChatSession } from '../domain-ports';

const RETROSPECTIVE_SKIP_WORKFLOW_IDS: ReadonlySet<string> = new Set([
  'run_retrospective',
  'memory_learning_sweep',
  'project_orchestration_cycle_ceo',
]);

const QUEUE_STATUS_QUEUED = 'queued';
const PRIORITY_BYPASS = 'bypass';

@Injectable()
export class RetrospectiveEnqueueService {
  private readonly logger = new Logger(RetrospectiveEnqueueService.name);
  private resolvedSkipWorkflowUuids: ReadonlySet<string> | null = null;

  constructor(
    private readonly queue: RetrospectiveQueueRepository,
    private readonly gate: RetrospectiveGateService,
    private readonly drain: RetrospectiveDrainService,
    private readonly settings: SystemSettingsService,
    @Optional()
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly persistence?: IWorkflowPersistenceService,
  ) {}

  async enqueueWorkflowRun(
    event: WorkflowRunEvent,
    terminalStatus: string,
  ): Promise<void> {
    try {
      if (!(await resolveRetrospectiveEnabled(this.settings))) {
        return;
      }

      if (await this.isSuppressedWorkflow(event.workflowId)) {
        return;
      }

      const existing = await this.queue.findByRunId(event.workflowRunId);
      if (existing) {
        this.logger.debug(
          `RetrospectiveEnqueueService skipping run ${event.workflowRunId}: already queued (status=${existing.status}).`,
        );
        return;
      }

      const scopeId = resolveScopeId(event.stateVariables);
      const signalsJson: Record<string, unknown> =
        scopeId === null ? { scope_missing: true } : {};

      const created = await this.queue.create({
        workflow_run_id: event.workflowRunId,
        source_type: 'workflow_run',
        scope_id: scopeId,
        terminal_status: terminalStatus,
        status: QUEUE_STATUS_QUEUED,
        signals_json: signalsJson,
      });

      this.logger.log(
        `RetrospectiveEnqueueService queued run ${event.workflowRunId} (terminal=${terminalStatus}, scope=${scopeId ?? 'none'}).`,
      );

      await this.scoreAndMaybeBypass(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `RetrospectiveEnqueueService swallowed unhandled error for run ${event.workflowRunId ?? 'unknown'}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async enqueueChatSession(chatSession: ChatSession): Promise<void> {
    try {
      if (!(await resolveRetrospectiveEnabled(this.settings))) {
        return;
      }

      const existing = await this.queue.findByChatSessionId(chatSession.id);
      if (existing) {
        this.logger.debug(
          `RetrospectiveEnqueueService skipping chat session ${chatSession.id}: already queued (status=${existing.status}).`,
        );
        return;
      }

      const scopeId = chatSession.scopeId ?? null;
      const signalsJson: Record<string, unknown> =
        scopeId === null ? { scope_missing: true } : {};

      const terminalStatus =
        chatSession.status === ChatSessionStatus.FAILED
          ? 'failed'
          : 'completed';

      const created = await this.queue.create({
        chat_session_id: chatSession.id,
        source_type: 'chat_session',
        scope_id: scopeId,
        terminal_status: terminalStatus,
        status: QUEUE_STATUS_QUEUED,
        signals_json: signalsJson,
      });

      this.logger.log(
        `RetrospectiveEnqueueService queued chat session ${chatSession.id} (terminal=${terminalStatus}, scope=${scopeId ?? 'none'}).`,
      );

      await this.scoreAndMaybeBypass(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `RetrospectiveEnqueueService swallowed unhandled error for chat session ${chatSession.id ?? 'unknown'}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async scoreAndMaybeBypass(row: RetrospectiveQueue): Promise<void> {
    try {
      const verdict = await this.gate.score(row);
      if (verdict.priority === PRIORITY_BYPASS) {
        if (row.source_type === 'workflow_run' && row.workflow_run_id) {
          await this.drain.analyzeImmediately(row.workflow_run_id);
        } else if (row.source_type === 'chat_session' && row.chat_session_id) {
          await this.drain.analyzeImmediately(undefined, row.chat_session_id);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `RetrospectiveEnqueueService gate/bypass failed for row ${row.id}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async isSuppressedWorkflow(workflowId: string): Promise<boolean> {
    if (RETROSPECTIVE_SKIP_WORKFLOW_IDS.has(workflowId)) {
      return true;
    }
    return (await this.resolveSkipWorkflowUuids()).has(workflowId);
  }

  private async resolveSkipWorkflowUuids(): Promise<ReadonlySet<string>> {
    const cached = this.resolvedSkipWorkflowUuids;
    if (cached !== null && cached.size > 0) {
      return cached;
    }
    if (this.persistence === undefined) {
      return new Set();
    }

    const uuids = new Set<string>();
    for (const key of RETROSPECTIVE_SKIP_WORKFLOW_IDS) {
      try {
        const workflow = await this.persistence.getWorkflow(key);
        if (typeof workflow.id === 'string' && workflow.id.length > 0) {
          uuids.add(workflow.id);
        }
      } catch {
        // Workflow not seeded / lookup failed — omit it (fail-soft).
      }
    }

    this.resolvedSkipWorkflowUuids = uuids;
    return uuids;
  }
}
