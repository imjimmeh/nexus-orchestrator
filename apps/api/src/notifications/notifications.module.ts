import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorkflowKernelModule } from '../workflow/kernel/workflow-kernel.module';
import { NotificationProducerService } from './notification-producer.service';
import { UserQuestionsNotificationListener } from './user-questions-notification.listener';
import { UserChannelIdentityInternalController } from './user-channel-identity-internal.controller';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationGateway } from './notification.gateway';

@Module({
  imports: [AuthModule, DatabaseModule, WorkflowKernelModule],
  controllers: [
    UserChannelIdentityInternalController,
    NotificationInboxController,
  ],
  providers: [
    NotificationProducerService,
    UserQuestionsNotificationListener,
    NotificationGateway,
  ],
  exports: [NotificationProducerService, NotificationGateway],
})
export class NotificationsModule {}
