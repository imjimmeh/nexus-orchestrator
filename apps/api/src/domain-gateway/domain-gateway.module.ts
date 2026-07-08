import { Module } from '@nestjs/common';
import { DomainEventsGateway } from './domain-events.gateway';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [DomainEventsGateway],
})
export class DomainGatewayModule {}
