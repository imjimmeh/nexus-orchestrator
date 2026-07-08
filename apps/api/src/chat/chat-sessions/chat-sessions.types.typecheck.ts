import {
  ChatSessionSource,
  ChatSessionStatus,
  ChatSessionType,
} from '@nexus/core';
import type {
  ChatSessionSummaryDto,
  CreateChatSessionInput,
} from './chat-sessions.types';

export const createChatSessionInputUsesCamelCaseSessionType: CreateChatSessionInput =
  {
    agentProfileName: 'ceo-agent',
    initialMessage: 'hello',
    sessionType: ChatSessionType.GENERAL,
  };

export const createChatSessionInputRejectsSnakeCaseSessionType: CreateChatSessionInput =
  {
    ...createChatSessionInputUsesCamelCaseSessionType,
    // @ts-expect-error Controller/service input should use sessionType.
    session_type: ChatSessionType.GENERAL,
  };

export const chatSessionSummaryUsesCamelCaseSessionType: ChatSessionSummaryDto =
  {
    id: 'chat-session-1',
    status: ChatSessionStatus.RUNNING,
    executionState: 'running',
    retryMetadata: null,
    failureInfo: null,
    sessionType: ChatSessionType.GENERAL,
    agentProfileName: 'ceo-agent',
    scopeId: null,
    projectName: null,
    displayName: 'General chat',
    initialMessage: 'hello',
    workflowRunId: null,
    source: ChatSessionSource.AD_HOC,
    parentChatSessionId: null,
    createdAt: new Date('2026-04-14T10:00:00.000Z'),
    completedAt: null,
  };

export const chatSessionSummaryRejectsSnakeCaseSessionType: ChatSessionSummaryDto =
  {
    ...chatSessionSummaryUsesCamelCaseSessionType,
    // @ts-expect-error Public API summary DTOs should expose sessionType.
    session_type: ChatSessionType.GENERAL,
  };
