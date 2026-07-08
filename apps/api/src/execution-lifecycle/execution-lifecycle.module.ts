import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { ExecutionEntity } from './database/entities/execution.entity';
import { EventLedger } from '../runtime/database/entities/event-ledger.entity';
import { ExecutionRepository } from './database/repositories/execution.repository';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { ExecutionHeartbeatService } from './execution-heartbeat.service';
import { ExecutionProjector } from './execution.projector';
import {
  ExecutionSupervisorService,
  type CheckpointPersistenceDeps,
} from './execution-supervisor.service';
import { AgentEndSignalReader } from './agent-end-signal.reader';
import { JobOutputCompletionSignalReader } from './job-output-completion-signal.reader';
import { SubagentContainerLivenessProbe } from './subagent-container-liveness.probe';
import { ExecutionDispatchService } from './execution-dispatch.service';
import { ExecutionInstanceIdentityService } from './execution-instance-identity.service';
import { ExecutionOwnerLeaseService } from './execution-owner-lease.service';
import { DefaultOrchestratorIpResolver } from './default-orchestrator-ip-resolver';
import { CustomHttpEndpointIpResolver } from './custom-http-endpoint-ip-resolver';
import { DnsRoundRobinIpResolver } from './dns-round-robin-ip-resolver';
import { ServiceMeshHeaderIpResolver } from './service-mesh-header-ip-resolver';
import { SystemSettingOrchestratorIpResolver } from './system-setting-orchestrator-ip-resolver';
import {
  CUSTOM_HTTP_ENDPOINT_IP_RESOLVER,
  DEFAULT_ORCHESTRATOR_IP_RESOLVER,
  DNS_ROUND_ROBIN_IP_RESOLVER,
  ORCHESTRATOR_IP_RESOLVER,
  SERVICE_MESH_HEADER_IP_RESOLVER,
} from './execution-dispatch.service.types';
import { ExecutionsController } from './executions.controller';
import { StepSessionCheckpointModule } from '../workflow/workflow-session-checkpoint/step-session-checkpoint.module';
import { StepSessionCheckpointRepository } from '../workflow/workflow-session-checkpoint/step-session-checkpoint.repository';
import {
  SESSION_HYDRATION_SERVICE,
  type ISessionHydrationService,
} from '../shared/interfaces/session-hydration.interface';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';
import { ShutdownStateService } from '../shutdown/shutdown-state.service';
import { ShutdownStateModule } from '../shutdown/shutdown-state.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import {
  CONTAINER_FREEZER,
  ShutdownFreezeCoordinator,
  STEP_QUEUE_DRAINER,
} from './shutdown-freeze.coordinator';
import {
  CONTAINER_RESUMER,
  SESSION_REHYDRATOR,
  StartupResumeCoordinator,
} from './startup-resume.coordinator';
import { StepQueueDrainerAdapter } from './step-queue-drainer.adapter';
import { SessionRehydratorAdapter } from './session-rehydrator.adapter';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExecutionEntity, EventLedger]),
    AiConfigModule,
    DockerModule,
    DomainEventsModule,
    forwardRef(() => SessionModule),
    StepSessionCheckpointModule,
    ShutdownStateModule,
    SystemSettingsModule,
  ],
  controllers: [ExecutionsController],
  providers: [
    ExecutionRepository,
    AgentEndSignalReader,
    JobOutputCompletionSignalReader,
    ExecutionEventPublisher,
    ExecutionProjector,
    SubagentContainerLivenessProbe,
    {
      provide: ExecutionSupervisorService,
      useFactory: (
        repo: ExecutionRepository,
        publisher: ExecutionEventPublisher,
        probe: SubagentContainerLivenessProbe,
        lifecycle: ServiceLifecycleStateService,
        checkpointRepo: StepSessionCheckpointRepository,
        sessionHydration: ISessionHydrationService,
        shutdownState: ShutdownStateService,
        agentEndSignalReader: AgentEndSignalReader,
        jobOutputReader: JobOutputCompletionSignalReader,
      ) => {
        const checkpointDeps: CheckpointPersistenceDeps = {
          checkpointRepo,
          sessionHydration,
        };
        return new ExecutionSupervisorService(
          repo,
          publisher,
          probe,
          lifecycle,
          shutdownState,
          agentEndSignalReader,
          checkpointDeps,
          jobOutputReader,
        );
      },
      inject: [
        ExecutionRepository,
        ExecutionEventPublisher,
        SubagentContainerLivenessProbe,
        ServiceLifecycleStateService,
        StepSessionCheckpointRepository,
        SESSION_HYDRATION_SERVICE,
        ShutdownStateService,
        AgentEndSignalReader,
        JobOutputCompletionSignalReader,
      ],
    },
    ExecutionHeartbeatService,
    ExecutionInstanceIdentityService,
    ExecutionOwnerLeaseService,
    ExecutionDispatchService,
    ServiceLifecycleStateService,
    ShutdownFreezeCoordinator,
    StartupResumeCoordinator,
    StepQueueDrainerAdapter,
    SessionRehydratorAdapter,
    { provide: CONTAINER_FREEZER, useExisting: ContainerOrchestratorService },
    { provide: CONTAINER_RESUMER, useExisting: ContainerOrchestratorService },
    { provide: STEP_QUEUE_DRAINER, useExisting: StepQueueDrainerAdapter },
    { provide: SESSION_REHYDRATOR, useExisting: SessionRehydratorAdapter },
    {
      provide: DEFAULT_ORCHESTRATOR_IP_RESOLVER,
      useClass: DefaultOrchestratorIpResolver,
    },
    {
      provide: DNS_ROUND_ROBIN_IP_RESOLVER,
      useClass: DnsRoundRobinIpResolver,
    },
    {
      provide: SERVICE_MESH_HEADER_IP_RESOLVER,
      useClass: ServiceMeshHeaderIpResolver,
    },
    {
      provide: CUSTOM_HTTP_ENDPOINT_IP_RESOLVER,
      useClass: CustomHttpEndpointIpResolver,
    },
    {
      provide: ORCHESTRATOR_IP_RESOLVER,
      useClass: SystemSettingOrchestratorIpResolver,
    },
  ],
  exports: [
    ExecutionEventPublisher,
    ExecutionRepository,
    ExecutionHeartbeatService,
    ExecutionOwnerLeaseService,
    ExecutionDispatchService,
    ServiceLifecycleStateService,
    StartupResumeCoordinator,
    SubagentContainerLivenessProbe,
  ],
})
export class ExecutionLifecycleModule {}
