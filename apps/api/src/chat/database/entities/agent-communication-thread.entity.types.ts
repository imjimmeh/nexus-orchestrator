export const AGENT_COMMUNICATION_THREAD_URGENCY_VALUES = [
  'normal',
  'high',
] as const;

export type AgentCommunicationThreadUrgency =
  (typeof AGENT_COMMUNICATION_THREAD_URGENCY_VALUES)[number];

export const AGENT_COMMUNICATION_THREAD_STATUS_VALUES = [
  'open',
  'resolved',
  'timed_out',
  'denied',
] as const;

export type AgentCommunicationThreadStatus =
  (typeof AGENT_COMMUNICATION_THREAD_STATUS_VALUES)[number];
