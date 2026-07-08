import { Module } from '@nestjs/common';
import { ChatCoreLookupService } from './chat-core-lookup.service';
import { ChatToCoreActionService } from './chat-to-core-action.service';

@Module({
  providers: [ChatToCoreActionService, ChatCoreLookupService],
  exports: [ChatToCoreActionService, ChatCoreLookupService],
})
export class ChatActionsModule {}
