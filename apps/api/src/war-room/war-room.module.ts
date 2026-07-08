import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { WorkflowKernelModule } from '../workflow/kernel/workflow-kernel.module';
import { WAR_ROOM_EVENT_LOG_PORT } from './ports/event-log.port';
import { WarRoomService } from './war-room.service';
import { WarRoomWorkflowEventLogService } from './war-room-workflow-event-log.service';

@Module({
  imports: [
    DatabaseModule,
    ObservabilityModule,
    SystemSettingsModule,
    WorkflowKernelModule,
  ],
  providers: [
    WarRoomService,
    WarRoomWorkflowEventLogService,
    {
      provide: WAR_ROOM_EVENT_LOG_PORT,
      useExisting: WarRoomWorkflowEventLogService,
    },
  ],
  exports: [WarRoomService],
})
export class WarRoomModule {}
