export const AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES = [
  'architect',
  'dev',
  'qa',
  'pm',
  'moderator',
] as const;

export type AgentWarRoomParticipantRole =
  (typeof AGENT_WAR_ROOM_PARTICIPANT_ROLE_VALUES)[number];

export const AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES = [
  'invited',
  'active',
  'left',
  'declined',
] as const;

export type AgentWarRoomParticipationStatus =
  (typeof AGENT_WAR_ROOM_PARTICIPATION_STATUS_VALUES)[number];
