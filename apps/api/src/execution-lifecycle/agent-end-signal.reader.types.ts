export type AgentEndSignal = {
  endedAtMs: number;
  outcome: 'success' | 'failure';
};
