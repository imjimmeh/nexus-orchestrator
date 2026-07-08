export const CHAT_SESSION_PARTICIPANT_ROLE_VALUES = [
  'owner',
  'participant',
  'moderator',
] as const;

export type ChatSessionParticipantRole =
  (typeof CHAT_SESSION_PARTICIPANT_ROLE_VALUES)[number];

export const CHAT_SESSION_PARTICIPATION_STATUS_VALUES = [
  'invited',
  'active',
  'declined',
  'left',
  'removed',
] as const;

export type ChatSessionParticipationStatus =
  (typeof CHAT_SESSION_PARTICIPATION_STATUS_VALUES)[number];
