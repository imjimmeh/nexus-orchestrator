export const AGENT_COMMUNICATION_MESSAGE_KIND_VALUES = [
  'request',
  'response',
  'system',
] as const;

export type AgentCommunicationMessageKind =
  (typeof AGENT_COMMUNICATION_MESSAGE_KIND_VALUES)[number];
