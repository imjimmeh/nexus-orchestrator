export const AGENT_WAR_ROOM_SESSION_STATUS_VALUES = ['open', 'closed'] as const;

export type AgentWarRoomSessionStatus =
  (typeof AGENT_WAR_ROOM_SESSION_STATUS_VALUES)[number];

export const AGENT_WAR_ROOM_CONSENSUS_STATE_VALUES = [
  'collecting_input',
  'draft_ready',
  'partial_signoff',
  'consensus_reached',
  'deadlocked',
  'ceo_tie_break_applied',
] as const;

export type AgentWarRoomConsensusState =
  (typeof AGENT_WAR_ROOM_CONSENSUS_STATE_VALUES)[number];

export const AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES = [
  'consensus',
  'deadlock',
  'ceo_tie_break',
  'manual',
] as const;

export type AgentWarRoomResolutionType =
  (typeof AGENT_WAR_ROOM_RESOLUTION_TYPE_VALUES)[number];
