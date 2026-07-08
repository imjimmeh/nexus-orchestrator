import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { WorkflowKernelModule } from '../workflow/kernel/workflow-kernel.module';
import { AutomationHooksController } from './automation-hooks.controller';
import { AutomationHooksListener } from './automation-hooks.listener';
import { AutomationHooksService } from './automation-hooks.service';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatRunStatusListener } from './heartbeat-run-status.listener';
import { HeartbeatRunnerService } from './heartbeat-runner.service';
import { HeartbeatService } from './heartbeat.service';
import { ScheduledJobRunStatusListener } from './scheduled-job-run-status.listener';
import { ScheduledJobsConsumer } from './scheduled-jobs.consumer';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsPollingService } from './scheduled-jobs-polling.service';
import { ScheduledJobsRunnerService } from './scheduled-jobs-runner.service';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduleExpressionService } from './schedule-expression.service';
import { StandingOrdersController } from './standing-orders.controller';
import { StandingOrdersService } from './standing-orders.service';
import { SCHEDULED_JOBS_QUEUE } from './scheduled-jobs.constants';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ObservabilityModule,
    SystemSettingsModule,
    WorkflowKernelModule,
    BullModule.registerQueue({
      name: SCHEDULED_JOBS_QUEUE,
    }),
  ],
  controllers: [
    AutomationHooksController,
    HeartbeatController,
    ScheduledJobsController,
    StandingOrdersController,
  ],
  providers: [
    AutomationHooksService,
    AutomationHooksListener,
    HeartbeatRunnerService,
    HeartbeatService,
    HeartbeatRunStatusListener,
    ScheduleExpressionService,
    ScheduledJobsRunnerService,
    ScheduledJobsService,
    ScheduledJobsPollingService,
    ScheduledJobsConsumer,
    ScheduledJobRunStatusListener,
    StandingOrdersService,
  ],
  exports: [ScheduledJobsService, StandingOrdersService],
})
export class AutomationModule {
  protected readonly _moduleName = 'AutomationModule';
}
