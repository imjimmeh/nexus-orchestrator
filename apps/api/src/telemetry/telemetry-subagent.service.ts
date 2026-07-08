import { Injectable, Optional } from '@nestjs/common';
import { SubagentOrchestratorService } from '../workflow/workflow-subagents/subagent-orchestrator.service';
import { WorkflowRuntimeTerminalRunGuardService } from '../workflow/workflow-runtime/workflow-runtime-terminal-run-guard.service';
import {
  handleCheckSubagentStatusCompat,
  handleSpawnSubagentAsyncCompat,
  handleWaitForSubagentsCompat,
} from './telemetry-gateway-subagent.helpers';
import { TelemetryContainerContextService } from './telemetry-container-context.service';
import type {
  AuthenticatedSocket,
  CheckSubagentStatusPayload,
  SpawnSubagentAsyncPayload,
  WaitForSubagentsPayload,
} from './types';

/**
 * Owns the subagent orchestration `@SubscribeMessage` handlers
 * (`spawn_subagent_async`, `wait_for_subagents`, `check_subagent_status`).
 * These commands are dispatched directly to the agent socket — they don't
 * flow through the replay stream or the event ledger — so they belong in a
 * separate service rather than the event broadcaster.
 *
 * The gateway injects this service and delegates each subscribe handler to
 * the corresponding method here.
 */
@Injectable()
export class TelemetrySubagentGatewayService {
  constructor(
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    private readonly containerContext: TelemetryContainerContextService,
    @Optional()
    private readonly terminalRunGuard?: WorkflowRuntimeTerminalRunGuardService,
  ) {}

  async handleSpawnSubagentAsync(
    client: AuthenticatedSocket,
    payload: SpawnSubagentAsyncPayload,
  ): Promise<void> {
    await handleSpawnSubagentAsyncCompat({
      client,
      payload,
      subagentOrchestrator: this.subagentOrchestrator,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
      terminalRunGuard: this.terminalRunGuard,
    });
  }

  async handleWaitForSubagents(
    client: AuthenticatedSocket,
    payload?: WaitForSubagentsPayload,
  ): Promise<void> {
    await handleWaitForSubagentsCompat({
      client,
      payload,
      subagentOrchestrator: this.subagentOrchestrator,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
    });
  }

  async handleCheckSubagentStatus(
    client: AuthenticatedSocket,
    payload: CheckSubagentStatusPayload,
  ): Promise<void> {
    await handleCheckSubagentStatusCompat({
      client,
      payload,
      subagentOrchestrator: this.subagentOrchestrator,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
    });
  }
}
