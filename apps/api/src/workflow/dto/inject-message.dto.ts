import { injectMessageSchema, type InjectMessageRequest } from '@nexus/core';

export class InjectMessageDto {
  static readonly schema = injectMessageSchema;

  message!: InjectMessageRequest['message'];
}
