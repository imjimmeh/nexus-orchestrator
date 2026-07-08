import { describe, expect, it, vi } from 'vitest';
import {
  ChatSessionType,
  ChatSessionSource,
  ChatSessionStatus,
  type ChatSessionExecutionState,
} from '@nexus/core';
import {
  mapSessionSummaryDto,
  buildChatSessionCreatePayload,
} from './chat-sessions.mappers';

describe('chat session mappers', () => {
  it('maps execution and retry visibility fields to camelCase DTO fields', async () => {
    const retryMetadata = {
      attempt: 1,
      maxAttempts: 3,
      nextRetryAt: '2026-04-14T10:10:00.000Z',
      reasonCode: 'rate_limit_exceeded',
    };
    const failureInfo = {
      reasonCode: 'rate_limit_exceeded',
      message: 'Rate limit exceeded',
      occurredAt: '2026-04-14T10:02:00.000Z',
      retryable: true,
    };

    const result = await mapSessionSummaryDto(
      {
        id: 'chat-visible',
        status: 'RUNNING',
        execution_state: 'retry_scheduled',
        retry_metadata: retryMetadata,
        failure_info: failureInfo,
        session_type: ChatSessionType.GENERAL,
        agent_profile_name: 'ceo-agent',
        scope_id: null,
        display_name: 'Retry visible',
        initial_message: 'hello',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      },
      vi.fn(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        executionState: 'retry_scheduled',
        retryMetadata,
        failureInfo,
        sessionType: ChatSessionType.GENERAL,
      }),
    );
    expect(result).not.toHaveProperty('session_type');
  });

  it('maps missing retry visibility metadata to null DTO fields', async () => {
    const result = await mapSessionSummaryDto(
      {
        id: 'chat-visible',
        status: 'RUNNING',
        execution_state: 'running',
        session_type: ChatSessionType.GENERAL,
        agent_profile_name: 'ceo-agent',
        scope_id: null,
        display_name: 'Retry visible',
        initial_message: 'hello',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      },
      vi.fn(),
    );

    expect(result.retryMetadata).toBeNull();
    expect(result.failureInfo).toBeNull();
  });

  it('maps source and parentChatSessionId for subagent sessions', async () => {
    const result = await mapSessionSummaryDto(
      {
        id: 'subagent-session',
        status: 'RUNNING',
        execution_state: 'running',
        session_type: ChatSessionType.GENERAL,
        agent_profile_name: 'worker-agent',
        display_name: 'Subagent Task',
        initial_message: 'Do this subtask',
        created_at: new Date('2026-05-01T10:00:00.000Z'),
        completed_at: null,
        source: ChatSessionSource.SUBAGENT,
        parent_chat_session_id: 'parent-session-id',
      },
      vi.fn(),
    );

    expect(result.source).toBe(ChatSessionSource.SUBAGENT);
    expect(result.parentChatSessionId).toBe('parent-session-id');
  });

  it('maps source as ad-hoc and null parentChatSessionId for regular sessions', async () => {
    const result = await mapSessionSummaryDto(
      {
        id: 'regular-session',
        status: 'RUNNING',
        execution_state: 'running',
        session_type: ChatSessionType.GENERAL,
        agent_profile_name: 'ceo-agent',
        display_name: 'Regular Chat',
        initial_message: 'hello',
        created_at: new Date('2026-05-01T10:00:00.000Z'),
        completed_at: null,
        source: ChatSessionSource.AD_HOC,
        parent_chat_session_id: null,
      },
      vi.fn(),
    );

    expect(result.source).toBe(ChatSessionSource.AD_HOC);
    expect(result.parentChatSessionId).toBeNull();
  });
});

describe('buildChatSessionCreatePayload harness_id', () => {
  const base = {
    profile: { id: 'p1', name: 'ceo-agent' },
    status: ChatSessionStatus.STARTING,
    executionState: 'starting' as ChatSessionExecutionState,
    source: ChatSessionSource.AD_HOC,
    initialMessage: 'hi',
  };

  it('sets harness_id when provided', () => {
    const payload = buildChatSessionCreatePayload({
      ...base,
      harnessId: 'claude-code',
    });
    expect(payload.harness_id).toBe('claude-code');
  });

  it('defaults harness_id to null when omitted', () => {
    const payload = buildChatSessionCreatePayload(base);
    expect(payload.harness_id).toBeNull();
  });
});
