import { Module } from '@nestjs/common';
import { DockerModule } from '../docker/docker.module';
import { ObservabilityModule } from '../observability/observability.module';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryWarRoomGateway } from './telemetry-war-room.gateway';
import { ChatSessionCollaborationClient } from './chat-session-collaboration.client';
import { ExecutionLifecycleModule } from '../execution-lifecycle/execution-lifecycle.module';
import { RedisModule } from '../redis/redis.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { WarRoomModule } from '../war-room/war-room.module';
import { CostGovernanceModule } from '../cost-governance/cost-governance.module';
import { TELEMETRY_GATEWAY } from '../shared/interfaces/telemetry-gateway.interface';
import { SessionModule } from '../session/session.module';
import { WorkflowCoreModule } from '../workflow/workflow-core.module';
import { WorkflowRuntimeModule } from '../workflow/workflow-runtime/workflow-runtime.module';
import { WorkflowRunOperationsModule } from '../workflow/workflow-run-operations/workflow-run-operations.module';
import { WorkflowSubagentsModule } from '../workflow/workflow-subagents/workflow-subagents.module';
import { WorkflowStepExecutionModule } from '../workflow/workflow-step-execution/workflow-step-execution.module';
import { TelemetryEventService } from './telemetry-event.service';
import { TelemetryGatewayLifecycle } from './telemetry-gateway-lifecycle.service';
import { TelemetrySubagentGatewayService } from './telemetry-subagent.service';
import { TelemetryContainerContextService } from './telemetry-container-context.service';
import { TelemetrySessionCheckpointService } from './telemetry-session-checkpoint.service';
import { TelemetryAgentCommandService } from './telemetry-agent-command.service';

@Module({
  imports: [
    DockerModule,
    ExecutionLifecycleModule,
    ObservabilityModule,
    RedisModule,
    SessionModule,
    SystemSettingsModule,
    WarRoomModule,
    CostGovernanceModule,
    WorkflowCoreModule,
    WorkflowRuntimeModule,
    WorkflowRunOperationsModule,
    WorkflowSubagentsModule,
    WorkflowStepExecutionModule,
  ],
  providers: [
    TelemetrySessionCheckpointService,
    TelemetryContainerContextService,
    TelemetryEventService,
    TelemetryGatewayLifecycle,
    TelemetrySubagentGatewayService,
    TelemetryAgentCommandService,
    TelemetryGateway,
    TelemetryWarRoomGateway,
    ChatSessionCollaborationClient,
    {
      provide: TELEMETRY_GATEWAY,
      useExisting: TelemetryAgentCommandService,
    },
  ],
  exports: [TELEMETRY_GATEWAY, TelemetryAgentCommandService, TelemetryGateway],
})
export class TelemetryModule {
  /** Real-time telemetry and WebSocket gateway module */
  protected readonly _moduleName = 'TelemetryModule';
}
