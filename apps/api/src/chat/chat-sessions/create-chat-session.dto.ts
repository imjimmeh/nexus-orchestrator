import {
  type CreateChatSessionParticipantRequest,
  type CreateChatSessionRequest,
  createChatSessionParticipantSchema,
  createChatSessionSchema,
} from '@nexus/core';

export { createChatSessionParticipantSchema, createChatSessionSchema };

export class CreateChatSessionParticipantDto {
  static readonly schema = createChatSessionParticipantSchema;

  agent_profile!: CreateChatSessionParticipantRequest['agent_profile'];

  role?: CreateChatSessionParticipantRequest['role'];
}

export class CreateChatSessionDto {
  static readonly schema = createChatSessionSchema;

  agentProfileName!: CreateChatSessionRequest['agentProfileName'];

  scopeId?: CreateChatSessionRequest['scopeId'];

  initialMessage!: CreateChatSessionRequest['initialMessage'];

  sessionType?: CreateChatSessionRequest['sessionType'];

  displayName?: CreateChatSessionRequest['displayName'];

  participants?: CreateChatSessionRequest['participants'];

  moderatorProfile?: CreateChatSessionRequest['moderatorProfile'];
}
