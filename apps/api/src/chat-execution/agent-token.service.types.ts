export interface AgentTokenPayload {
  chatSessionId: string;
  agentProfileName: string;
  contextId?: string | null;
}
