import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChannelAdaptersModule } from '../channel-adapters/channel-adapters.module';
import { RedisModule } from '../../redis/redis.module';
import { NotificationConsumerService } from './notification-consumer.service';

@Module({
  imports: [DatabaseModule, ChannelAdaptersModule, RedisModule],
  providers: [NotificationConsumerService],
})
export class NotificationsModule {}
