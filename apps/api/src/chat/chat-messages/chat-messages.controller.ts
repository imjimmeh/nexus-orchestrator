import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  sendChatMessageSchema,
  submitChatQuestionAnswersSchema,
  type SendChatMessageRequest,
  type SubmitChatQuestionAnswersRequest,
} from '@nexus/core';
import { ChatClientAuthGuard } from '../common/chat-client-auth.guard';
import { InternalServiceScopes } from '../common/internal-service-scopes.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ChatMessagesService } from './chat-messages.service';

@UseGuards(ChatClientAuthGuard)
@Controller('sessions/chat')
export class ChatMessagesController {
  constructor(private readonly chatMessages: ChatMessagesService) {}

  @Get(':chatId/events')
  @InternalServiceScopes('chat.sessions:read')
  async getEventHistory(@Param('chatId') chatId: string) {
    const data = await this.chatMessages.getEventHistory(chatId);
    return { success: true, data };
  }

  @Post(':chatId/messages')
  @InternalServiceScopes('chat.sessions:write')
  async sendChatMessage(
    @Param('chatId') chatId: string,
    @ZodBody(sendChatMessageSchema) body: SendChatMessageRequest,
  ) {
    const data = await this.chatMessages.sendChatMessage(chatId, body.message, {
      attachmentIds: body.attachmentIds,
    });
    return { success: true, data };
  }

  @Post(':chatId/question-answers')
  @InternalServiceScopes('chat.sessions:write')
  async submitQuestionAnswers(
    @Param('chatId') chatId: string,
    @ZodBody(submitChatQuestionAnswersSchema)
    body: SubmitChatQuestionAnswersRequest,
  ) {
    const data = await this.chatMessages.submitQuestionAnswers(
      chatId,
      body.answers,
    );
    return { success: true, data };
  }
}
