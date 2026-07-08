import type {
  WorkflowRunExecutionStatusV1,
  AskUserQuestion,
  AskUserQuestionAnswer,
} from '@nexus/core';
import type { ChatChannelProvider } from '../channel-adapters/chat-channel-provider.types';

export interface ChatActionMemoryContextSlice {
  memoryId: string;
  source: 'session' | 'profile';
  memoryType: 'preference' | 'fact' | 'history';
  content: string;
  score: number;
}

export interface ChatActionMemoryContext {
  retrievalId: string;
  hitCount: number;
  sessionHitCount: number;
  profileHitCount: number;
  tokenBudget: number;
  slices: ChatActionMemoryContextSlice[];
}

export interface ChatActionRequestContext {
  chatSessionId: string;
  messageId: string;
  message: string;
  /**
   * Curated channel discriminant (see `chat-channel-provider.types.ts`).
   * TypeScript surfaces IDE autocomplete for the known providers (`'telegram'`,
   * `'email'`) while still accepting any `string` literal through the
   * `(string & {})` escape hatch — so callers that currently hand the runtime
   * provider id through as a string (e.g. `'api'`) keep compiling without
   * `as` casts, but consumers that read this field through a known discriminated
   * set get exhaustiveness benefits.
   */
  channel: ChatChannelProvider;
  agentProfileName: string;
  scopeId?: string | null;
  workflowId?: string | null;
  externalUserId?: string | null;
  idempotencyKey?: string | null;
  requestedBy?: string | null;
  memoryContext?: ChatActionMemoryContext | null;
}

export interface ChatActionRunLink {
  runId?: string;
  workflowId?: string;
  run_id?: string;
  workflow_id?: string;
  runStatus: WorkflowRunExecutionStatusV1;
  correlation_id?: string;
  correlationId?: string;
}

export interface ChatActionWorkflowRunEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type ChatActionUserQuestion = AskUserQuestion;

export type ChatActionQuestionAnswer = AskUserQuestionAnswer;
