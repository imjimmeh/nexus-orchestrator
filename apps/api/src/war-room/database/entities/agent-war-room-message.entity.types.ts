export const AGENT_WAR_ROOM_MESSAGE_KIND_VALUES = [
  'proposal',
  'question',
  'response',
  'system',
] as const;

export type AgentWarRoomMessageKind =
  (typeof AGENT_WAR_ROOM_MESSAGE_KIND_VALUES)[number];
