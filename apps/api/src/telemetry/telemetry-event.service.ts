import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisStreamService } from '../redis/redis-stream.service';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { AgentResponseStoreService } from '../redis/agent-response-store.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { ExecutionHeartbeatService } from '../execution-lifecycle/execution-heartbeat.service';
import { WorkflowRunHeartbeatService } from '../workflow/workflow-run-operations/workflow-run-heartbeat.service';
import { TurnUsageRecorderService } from '../cost-governance/turn-usage-recorder.service';
import { StepCompletionFinalizerService } from '../workflow/workflow-step-execution/step-completion-finalizer.service';
import { WorkflowStepCompletionGuardService } from '../workflow/workflow-step-completion-guard.service';
import { WorkflowRuntimeTerminalRunGuardService } from '../workflow/workflow-runtime/workflow-runtime-terminal-run-guard.service';
import { QuestionIdleTrackerService } from '../workflow/workflow-run-operations/question-idle-tracker.service';
import { SubagentOrchestratorService } from '../workflow/workflow-subagents/subagent-orchestrator.service';
import { processAndBroadcastEventCompat } from './telemetry-gateway-compat.helpers';
import {
  dispatchCommandGatewayEvent,
  type CommandEventType,
} from './command-output-gateway.helpers';
import {
  handleAgentTelemetryGatewayCompat,
  handleToolExecutionStartGatewayCompat,
  handleToolExecutionEndGatewayCompat,
  handleToolExecutionUpdateGatewayCompat,
  handleTurnEndGatewayCompat,
  handleAgentEndGatewayCompat,
  handleAgentErrorGatewayCompat,
  handleUserQuestionsPosedGatewayCompat,
  getClientStreamId,
} from './telemetry-gateway-runtime.helpers';
import { handleStepCompleteGatewayCompat } from './telemetry-gateway-step-complete.helpers';
import { TelemetryContainerContextService } from './telemetry-container-context.service';
import { TelemetrySessionCheckpointService } from './telemetry-session-checkpoint.service';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';

/**
 * Owns event transformation, broadcasting, and per-message business logic
 * for the runtime telemetry gateway. The thin {@link TelemetryGateway}
 * delegates every `@SubscribeMessage` handler to a method here.
 *
 * The service holds every dependency those handlers need (stream/pubsub,
 * event ledger, response store, heartbeats, turn-usage recorder, subagent
 * orchestrator, completion guards, question idle tracker, event emitter).
 * The gateway never injects those services directly — it only injects this
 * facade.
 */
@Injectable()
export class TelemetryEventService {
  private readonly logger = new Logger(TelemetryEventService.name);

  constructor(
    private readonly streamService: RedisStreamService,
    private readonly pubsubService: RedisPubSubService,
    private readonly eventLedger: EventLedgerService,
    private readonly agentResponseStore: AgentResponseStoreService,
    private readonly containerContext: TelemetryContainerContextService,
    private readonly sessionCheckpoint: TelemetrySessionCheckpointService,
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    @Optional()
    private readonly questionIdleTracker?: QuestionIdleTrackerService,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
    @Optional()
    private readonly stepCompletionGuard?: WorkflowStepCompletionGuardService,
    @Optional()
    private readonly terminalRunGuard?: WorkflowRuntimeTerminalRunGuardService,
    @Optional()
    private readonly executionHeartbeat?: ExecutionHeartbeatService,
    @Optional()
    private readonly runHeartbeat?: WorkflowRunHeartbeatService,
    @Optional()
    private readonly turnUsageRecorder?: TurnUsageRecorderService,
    @Optional()
    private readonly stepCompletionFinalizer?: StepCompletionFinalizerService,
  ) {}

  /**
   * Low-level broadcast sink — persists the event to the workflow's replay
   * stream and publishes it on the pub/sub channel. Inlined here (rather
   * than re-bound at every call site) so the lifecycle service can pass the
   * same sink into the post-auth connection path.
   */
  async processAndBroadcastEvent(
    workflowRunId: string,
    event: { event_type: string; payload: GatewayEventPayload },
  ): Promise<void> {
    await processAndBroadcastEventCompat({
      workflowRunId,
      event,
      streamService: this.streamService,
      pubsubService: this.pubsubService,
    });
  }

  /**
   * Low-level command-event dispatch — keeps `command_output` off the replay
   * stream while persisting `command_started` and `command_finished`.
   */
  async dispatchCommandEvent(
    eventType: CommandEventType,
    workflowRunId: string,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await dispatchCommandGatewayEvent(eventType, {
      workflowRunId,
      payload,
      streamService: this.streamService,
      pubsubService: this.pubsubService,
    });
  }

  // ---------------------------------------------------------------------------
  // Per-message subscribe handlers — each is a thin delegation to the
  // existing compat helper, with bound service methods so the helpers stay
  // unchanged.
  // ---------------------------------------------------------------------------

  async handleAgentTelemetry(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleAgentTelemetryGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      executionHeartbeat: this.executionHeartbeat,
      runHeartbeat: this.runHeartbeat,
    });
  }

  async handleToolExecutionStart(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleToolExecutionStartGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      eventLedger: this.eventLedger,
      persistSessionCheckpoint: this.sessionCheckpoint.persistBound,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
      shouldPersistSessionCheckpoint: this.sessionCheckpoint.getShouldPersist(),
      executionHeartbeat: this.executionHeartbeat,
      runHeartbeat: this.runHeartbeat,
    });
  }

  async handleToolExecutionEnd(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleToolExecutionEndGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      eventLedger: this.eventLedger,
      persistSessionCheckpoint: this.sessionCheckpoint.persistBound,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
      shouldPersistSessionCheckpoint: this.sessionCheckpoint.getShouldPersist(),
      executionHeartbeat: this.executionHeartbeat,
      runHeartbeat: this.runHeartbeat,
    });
  }

  async handleToolExecutionUpdate(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleToolExecutionUpdateGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      eventLedger: this.eventLedger,
      executionHeartbeat: this.executionHeartbeat,
      runHeartbeat: this.runHeartbeat,
    });
  }

  async handleAgentError(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleAgentErrorGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      agentResponseStore: this.agentResponseStore,
    });
  }

  async handleUserQuestionsPosed(
    client: AuthenticatedSocket,
    payload: { questions: Array<Record<string, unknown>> },
  ): Promise<void> {
    await handleUserQuestionsPosedGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      questionIdleTracker: this.questionIdleTracker,
      eventEmitter: this.eventEmitter,
    });
  }

  async handleStepComplete(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleStepCompleteGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      agentResponseStore: this.agentResponseStore,
      stepCompletionGuard: this.stepCompletionGuard,
      terminalRunGuard: this.terminalRunGuard,
    });
  }

  async handleTurnEnd(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleTurnEndGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      eventLedger: this.eventLedger,
      agentResponseStore: this.agentResponseStore,
      persistSessionCheckpoint: this.sessionCheckpoint.persistBound,
      resolveContainerContext: this.containerContext.resolve.bind(
        this.containerContext,
      ),
      shouldPersistSessionCheckpoint: this.sessionCheckpoint.getShouldPersist(),
      executionHeartbeat: this.executionHeartbeat,
      runHeartbeat: this.runHeartbeat,
      turnUsageRecorder: this.turnUsageRecorder,
    });
  }

  async handleAgentEnd(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    await handleAgentEndGatewayCompat({
      client,
      payload,
      processAndBroadcastEvent: this.processAndBroadcastEvent.bind(this),
      eventLedger: this.eventLedger,
      agentResponseStore: this.agentResponseStore,
      subagentOrchestrator: this.subagentOrchestrator,
      stepCompletionFinalizer: this.stepCompletionFinalizer,
      turnUsageRecorder: this.turnUsageRecorder,
      questionIdleTracker: this.questionIdleTracker,
    });
  }

  async handleCommandStarted(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    const streamId = getClientStreamId(client);
    if (!streamId) {
      return;
    }
    await this.dispatchCommandEvent('command_started', streamId, payload);
  }

  async handleCommandOutput(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    const streamId = getClientStreamId(client);
    if (!streamId) {
      return;
    }
    await this.dispatchCommandEvent('command_output', streamId, payload);
  }

  async handleCommandFinished(
    client: AuthenticatedSocket,
    payload: GatewayEventPayload,
  ): Promise<void> {
    const streamId = getClientStreamId(client);
    if (!streamId) {
      return;
    }
    await this.dispatchCommandEvent('command_finished', streamId, payload);
  }
}
