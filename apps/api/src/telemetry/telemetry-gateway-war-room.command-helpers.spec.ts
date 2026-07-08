import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { requireWarRoomRunContext } from './telemetry-gateway-war-room.command-helpers';
import type { AuthenticatedSocket } from './types';

describe('requireWarRoomRunContext', () => {
  const loggerWarn = vi.fn();
  const logger = {
    warn: loggerWarn,
  } as unknown as Logger;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies chat-session-only scope with explicit error', () => {
    const emit = vi.fn();
    const client = {
      role: 'agent',
      chatSessionId: 'chat-123',
      workflowRunId: 'chat-123',
      emit,
    } as unknown as AuthenticatedSocket;

    const hasScope = requireWarRoomRunContext(
      client,
      logger,
      'open_war_room',
      'open_war_room_result',
    );

    expect(hasScope).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      'open_war_room: requires workflow run scope; chat session scope is not supported',
    );
    expect(emit).toHaveBeenCalledWith('command', {
      type: 'open_war_room_result',
      success: false,
      error:
        'open_war_room: requires workflow run scope; chat session scope is not supported',
    });
  });

  it('allows agent workflow run scope when it is distinct from chat session id', () => {
    const emit = vi.fn();
    const client = {
      role: 'agent',
      chatSessionId: 'chat-123',
      workflowRunId: 'workflow-456',
      emit,
    } as unknown as AuthenticatedSocket;

    const hasScope = requireWarRoomRunContext(
      client,
      logger,
      'open_war_room',
      'open_war_room_result',
    );

    expect(hasScope).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });
});
