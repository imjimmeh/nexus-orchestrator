export const AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES = [
  'approved',
  'changes_requested',
  'blocked',
] as const;

export type AgentWarRoomSignoffDecision =
  (typeof AGENT_WAR_ROOM_SIGNOFF_DECISION_VALUES)[number];
