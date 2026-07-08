import { forwardRef, Module } from "@nestjs/common";
import type { ServiceClientHttpOptions } from "@nexus/core";
import { CoreLifecycleStreamConsumerService } from "./core-lifecycle-stream.consumer";
import { CoreIntegrationEventRouter } from "./core-integration-event.router";
import { CoreLifecycleStreamImprovementTaskHandler } from "./core-lifecycle-stream-improvement-task.handler";
import { CoreLifecycleStreamPrMergedHandler } from "./core-lifecycle-stream-pr-merged.handler";
import { CoreLifecycleStreamPrStatusHandler } from "./core-lifecycle-stream-pr-status.handler";
import { CoreEventsController } from "./core-events.controller";
import { CoreRunProjectionService } from "./core-run-projection.service";
import { CoreModelPricingClientService } from "./core-model-pricing-client.service";
import { CoreScopeClientService } from "./core-scope-client.service";
import { CoreVariablesClientService } from "./core-variables-client.service";
import { CORE_VARIABLES_CLIENT } from "./core-variables-client.types";
import { CoreWorkflowClientService } from "./core-workflow-client.service";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";
import { KanbanRedisModule } from "./kanban-redis.module";
import { ModelPricingCacheSyncService } from "./model-pricing-cache-sync.service";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { ProjectModule } from "../project/project.module";
import { KanbanSettingsModule } from "../settings/kanban-settings.module";
import { WorkItemModule } from "../work-item/work-item.module";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

@Module({
  imports: [
    KanbanRedisModule,
    forwardRef(() => OrchestrationModule),
    forwardRef(() => ProjectModule),
    forwardRef(() => WorkItemModule),
    KanbanSettingsModule,
  ],
  controllers: [CoreEventsController],
  providers: [
    CoreRunProjectionService,
    KanbanCoreAuthTokenProvider,
    {
      provide: KanbanCoreHttpClient,
      useFactory: (authTokenProvider: KanbanCoreAuthTokenProvider) => {
        const coreBaseUrl = readOptionalEnv("KANBAN_CORE_BASE_URL");
        const baseUrl = coreBaseUrl ?? DEFAULT_CORE_BASE_URL;
        const httpOptions: ServiceClientHttpOptions = {
          baseUrl,
          authorizationHeaderResolver: () =>
            authTokenProvider.resolveAuthorizationHeader(),
        };
        return new KanbanCoreHttpClient(baseUrl, httpOptions);
      },
      inject: [KanbanCoreAuthTokenProvider],
    },
    CoreWorkflowClientService,
    CoreModelPricingClientService,
    ModelPricingCacheSyncService,
    CoreScopeClientService,
    CoreVariablesClientService,
    { provide: CORE_VARIABLES_CLIENT, useClass: CoreVariablesClientService },
    CoreLifecycleStreamPrMergedHandler,
    CoreLifecycleStreamPrStatusHandler,
    CoreLifecycleStreamImprovementTaskHandler,
    CoreIntegrationEventRouter,
    CoreLifecycleStreamConsumerService,
  ],
  exports: [
    CoreRunProjectionService,
    CoreWorkflowClientService,
    CoreModelPricingClientService,
    CoreScopeClientService,
    CoreVariablesClientService,
    CORE_VARIABLES_CLIENT,
    CoreLifecycleStreamConsumerService,
  ],
})
export class CoreIntegrationModule {
  protected readonly moduleName = CoreIntegrationModule.name;
}

function readOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
