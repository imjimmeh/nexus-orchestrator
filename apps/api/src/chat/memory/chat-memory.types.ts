export type ChatMemoryType = 'preference' | 'fact' | 'history';

export type ChatMemoryJobType = 'distill_session' | 'consolidate_profile';

export type ChatMemoryJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type ChatMemorySourceRole = 'user' | 'assistant' | 'system';

export interface ChatMemoryContextSlice {
  memoryId: string;
  source: 'session' | 'profile';
  memoryType: ChatMemoryType;
  content: string;
  score: number;
  createdAt: string;
}

export interface ChatMemoryContextRetrieval {
  retrievalId: string;
  requestedAt: string;
  tokenBudget: number;
  hitCount: number;
  sessionHitCount: number;
  profileHitCount: number;
  consumedCharacters: number;
}

export interface ChatMemoryContextResult {
  retrieval: ChatMemoryContextRetrieval;
  slices: ChatMemoryContextSlice[];
}

export interface BuildChatMemoryContextInput {
  chatSessionId: string;
  profileId: string;
  prompt: string;
  tokenBudget?: number;
  maxSlices?: number;
}

export interface RecordSessionMemoryInput {
  chatSessionId: string;
  profileId: string;
  sourceMessageId: string;
  sourceRole: ChatMemorySourceRole;
  content: string;
  correlationId?: string | null;
  channel?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EnqueueDistillationJobInput {
  chatSessionId: string;
  profileId: string;
  triggerReason: 'turn_count' | 'session_close' | 'scheduled';
  idempotencyKey: string;
}

export interface EnqueueConsolidationJobInput {
  profileId: string;
  triggerReason: 'distillation' | 'scheduled';
  idempotencyKey: string;
}

export interface ChatMemoryLifecycleConfig {
  maxSessionEntries: number;
  distillationTurnInterval: number;
  contextTokenBudget: number;
  contextMaxSlices: number;
  pollIntervalMs: number;
  retryDelayMs: number;
  maxAttempts: number;
  /**
   * Whether `memory_context` should be assembled and injected into agent
   * prompts. Controlled by the `MEMORY_CONTEXT_INJECTION_ENABLED` env var
   * and used as a graduated-rollout guard. Defaults to `true` for P0.
   */
  memoryContextInjectionEnabled: boolean;
}

export interface ChatMemoryMetricsSnapshot {
  distillationSuccess: number;
  distillationFailure: number;
  promotionVolume: number;
  retrievalRequests: number;
  retrievalHits: number;
  retrievalHitRate: number;
}
