export interface ChatSessionJobData {
  chatSessionId: string;
  agentProfileName: string;
  agentProfileId: string;
  contextId: string | null;
  contextType: string | null;
  initialMessage: string;
  containerTier: number;
  retryGeneration?: number;
}
