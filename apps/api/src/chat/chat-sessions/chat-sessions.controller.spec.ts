import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from '../common/internal-service-scopes.decorator';
import { ChatSessionsController } from './chat-sessions.controller';

describe('ChatSessionsController', () => {
  it('maps camelCase create-session request fields to service input', async () => {
    const createdSession = {
      id: '9db73f10-f816-41d2-bc43-0964665b9810',
    };
    const service = {
      createSession: vi.fn().mockResolvedValue(createdSession),
    };
    const controller = new ChatSessionsController(
      service as never,
      {} as never,
    );

    const result = await controller.createSession(
      {
        agentProfileName: 'ceo-agent',
        scopeId: '12bbde68-9826-4b82-a0bb-bbc426925112',
        initialMessage: 'hello',
        displayName: 'General chat',
        sessionType: 'general',
      },
      { user: { sub: 'user-1' } },
    );

    expect(service.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileName: 'ceo-agent',
        scopeId: '12bbde68-9826-4b82-a0bb-bbc426925112',
        initialMessage: 'hello',
        displayName: 'General chat',
        sessionType: 'general',
      }),
    );
    expect(service.createSession.mock.calls[0]?.[0]).not.toHaveProperty(
      'session_type',
    );
    expect(result).toEqual({ success: true, data: { id: createdSession.id } });
  });

  it('exposes POST :chatId/retry with chat session write scope', () => {
    const handler = ChatSessionsController.prototype.retrySession;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':chatId/retry');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(
      Reflect.getMetadata(INTERNAL_SERVICE_SCOPES_METADATA_KEY, handler),
    ).toEqual(['chat.sessions:write']);
  });

  it('delegates manual retry to the chat sessions service', async () => {
    const retriedSession = {
      id: '9db73f10-f816-41d2-bc43-0964665b9810',
      executionState: 'starting',
    };
    const service = {
      retrySession: vi.fn().mockResolvedValue(retriedSession),
    };
    const controller = new ChatSessionsController(
      service as never,
      {} as never,
    );

    const result = await controller.retrySession(
      '9db73f10-f816-41d2-bc43-0964665b9810',
    );

    expect(service.retrySession).toHaveBeenCalledWith(
      '9db73f10-f816-41d2-bc43-0964665b9810',
    );
    expect(result).toEqual({ success: true, data: retriedSession });
  });
});
