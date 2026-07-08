import {
  type InviteChatSessionParticipantRequest,
  inviteChatSessionParticipantSchema,
} from '@nexus/core';

export class InviteChatSessionParticipantDto {
  static readonly schema = inviteChatSessionParticipantSchema;

  agent_profile!: InviteChatSessionParticipantRequest['agent_profile'];

  role?: InviteChatSessionParticipantRequest['role'];

  metadata?: InviteChatSessionParticipantRequest['metadata'];
}
