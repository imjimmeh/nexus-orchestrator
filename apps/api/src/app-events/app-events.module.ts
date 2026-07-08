import { Module } from '@nestjs/common';
import { AppEventsGateway } from './app-events.gateway';

@Module({
  providers: [AppEventsGateway],
})
export class AppEventsModule {}
