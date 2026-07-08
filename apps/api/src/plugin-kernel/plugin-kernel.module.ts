import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { WorkflowSpecialStepsModule } from '../workflow/workflow-special-steps/workflow-special-steps.module';
import { PluginContributionRegistryService } from './contributions/plugin-contribution-registry.service';
import { PluginProjectionOrchestratorService } from './contributions/plugin-projection-orchestrator.service';
import { PLUGIN_PROJECTION_ORCHESTRATOR } from './contributions/plugin-projection-orchestrator.token';
import { PluginToolInvocationController } from './contributions/plugin-tool-invocation.controller';
import { PluginToolInvocationService } from './contributions/plugin-tool-invocation.service';
import { PluginToolProjectionService } from './contributions/plugin-tool-projection.service';
import { PluginWorkflowHookProjectionService } from './contributions/plugin-workflow-hook-projection.service';
import { PluginWorkflowStepProjectionService } from './contributions/plugin-workflow-step-projection.service';
import { PluginCapabilityEndpointRegistryService } from './capabilities/plugin-capability-endpoint-registry.service';
import { PluginCapabilityEndpointInvocationService } from './capabilities/plugin-capability-endpoint-invocation.service';
import { PluginEventSubscriptionProjectionService } from './events/plugin-event-subscription-projection.service';
import { PluginEventPublisherService } from './events/plugin-event-publisher.service';
import { PluginEventDeliveryEngineService } from './events/plugin-event-delivery-engine.service';
import { PluginEventDeliveryWorkerService } from './events/plugin-event-delivery-worker.service';
import { PluginAuditService } from './plugin-audit.service';
import { PluginLifecycleStateMachineService } from './plugin-lifecycle-state-machine.service';
import { PluginLifecycleService } from './plugin-lifecycle.service';
import { PluginManagementController } from './plugin-management.controller';
import { PluginPolicyService } from './plugin-policy.service';
import {
  PLUGIN_CONTAINER_RUNTIME_CLIENT,
  PLUGIN_CONTAINER_RUNTIME_ENV,
  PluginContainerRuntimeAdapter,
} from './runtime/plugin-container-runtime.adapter';
import { PluginNoneRuntimeAdapter } from './runtime/plugin-none-runtime.adapter';
import { PluginRuntimeManagerService } from './runtime/plugin-runtime-manager.service';
import { PluginRuntimeHealthService } from './runtime/plugin-runtime-health.service';
import { PluginRuntimeSupervisorService } from './runtime/plugin-runtime-supervisor.service';
import { PLUGIN_RUNTIME_SUPERVISOR } from './runtime/plugin-runtime-supervisor.token';
import { PLUGIN_RUNTIME_ADAPTERS } from './runtime/plugin-runtime.types';
import { PluginWorkerRuntimeAdapter } from './runtime/plugin-worker-runtime.adapter';
import {
  defaultPluginWorkerProcessFactory,
  PLUGIN_WORKER_PROCESS_FACTORY,
  PLUGIN_WORKER_SOURCE_ENV,
} from './runtime/plugin-worker-runtime-ipc';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    DockerModule,
    ToolRegistryModule,
    WorkflowSpecialStepsModule,
  ],
  controllers: [PluginManagementController, PluginToolInvocationController],
  providers: [
    PluginAuditService,
    PluginContributionRegistryService,
    PluginProjectionOrchestratorService,
    PluginToolInvocationService,
    PluginToolProjectionService,
    PluginWorkflowHookProjectionService,
    PluginWorkflowStepProjectionService,
    PluginCapabilityEndpointRegistryService,
    PluginCapabilityEndpointInvocationService,
    PluginEventSubscriptionProjectionService,
    PluginEventPublisherService,
    PluginEventDeliveryEngineService,
    PluginEventDeliveryWorkerService,
    {
      provide: PLUGIN_PROJECTION_ORCHESTRATOR,
      useExisting: PluginProjectionOrchestratorService,
    },
    PluginLifecycleService,
    PluginLifecycleStateMachineService,
    PluginPolicyService,
    PluginNoneRuntimeAdapter,
    PluginWorkerRuntimeAdapter,
    PluginContainerRuntimeAdapter,
    PluginRuntimeHealthService,
    PluginRuntimeManagerService,
    PluginRuntimeSupervisorService,
    {
      provide: PLUGIN_RUNTIME_SUPERVISOR,
      useExisting: PluginRuntimeSupervisorService,
    },
    {
      provide: PLUGIN_CONTAINER_RUNTIME_CLIENT,
      useValue: undefined,
    },
    {
      provide: PLUGIN_CONTAINER_RUNTIME_ENV,
      useValue: process.env,
    },
    {
      provide: PLUGIN_WORKER_PROCESS_FACTORY,
      useValue: defaultPluginWorkerProcessFactory,
    },
    {
      provide: PLUGIN_WORKER_SOURCE_ENV,
      useValue: process.env,
    },
    {
      provide: PLUGIN_RUNTIME_ADAPTERS,
      useFactory: (
        noneRuntimeAdapter: PluginNoneRuntimeAdapter,
        workerRuntimeAdapter: PluginWorkerRuntimeAdapter,
        containerRuntimeAdapter: PluginContainerRuntimeAdapter,
      ) => [noneRuntimeAdapter, workerRuntimeAdapter, containerRuntimeAdapter],
      inject: [
        PluginNoneRuntimeAdapter,
        PluginWorkerRuntimeAdapter,
        PluginContainerRuntimeAdapter,
      ],
    },
  ],
  exports: [
    PluginAuditService,
    PluginContributionRegistryService,
    PluginProjectionOrchestratorService,
    PluginToolInvocationService,
    PluginToolProjectionService,
    PLUGIN_PROJECTION_ORCHESTRATOR,
    PluginWorkflowHookProjectionService,
    PluginWorkflowStepProjectionService,
    PluginCapabilityEndpointRegistryService,
    PluginCapabilityEndpointInvocationService,
    PluginEventSubscriptionProjectionService,
    PluginEventPublisherService,
    PluginEventDeliveryEngineService,
    PluginEventDeliveryWorkerService,
    PluginLifecycleService,
    PluginPolicyService,
    PluginRuntimeManagerService,
    PluginRuntimeHealthService,
    PluginRuntimeSupervisorService,
    PLUGIN_RUNTIME_SUPERVISOR,
  ],
})
export class PluginKernelModule {
  protected readonly _moduleName = 'PluginKernelModule';
}
