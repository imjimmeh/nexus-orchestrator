import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jwtLib from 'jsonwebtoken';
import { handleTelemetryConnectionCompat } from './telemetry-gateway-connection.helpers';

const JWT_SECRET = 'explicit-test-jwt-secret-at-least-32-chars';

function buildMockSocket(token: string) {
  return {
    handshake: { auth: { token } },
    disconnect: vi.fn(),
  } as Record<string, unknown>;
}

function buildMockDeps() {
  return {
    logger: { log: vi.fn(), error: vi.fn() },
    eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
    runnerConfigStore: { get: vi.fn().mockResolvedValue(null) },
    pubsubService: {
      subscribeToChannel: vi.fn().mockResolvedValue(undefined),
    },
    streamService: { getEventHistory: vi.fn().mockResolvedValue([]) },
    processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleTelemetryConnectionCompat — subagent stream isolation', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  it('keeps parent workflowRunId and uses chatSessionId as separate stream key for subagent JWTs', async () => {
    const token = jwtLib.sign(
      {
        workflowRunId: 'parent-run-1',
        chatSessionId: 'subagent-session-1',
        role: 'agent',
        isSubagent: true,
        subagentExecutionId: 'exec-1',
        stepId: 'exec-1',
      },
      JWT_SECRET,
    );

    const client = buildMockSocket(token);
    const deps = buildMockDeps();

    await handleTelemetryConnectionCompat({
      client: client as never,
      ...deps,
    });

    expect(client['chatSessionId']).toBe('subagent-session-1');
    expect(client['workflowRunId']).toBe('parent-run-1');
    expect(client['streamId']).toBe('subagent-session-1');
  });

  it('uses workflowRunId as stream key for non-subagent workflow JWTs', async () => {
    const token = jwtLib.sign(
      {
        workflowRunId: 'workflow-run-1',
        role: 'agent',
        isSubagent: false,
        stepId: 'step-1',
      },
      JWT_SECRET,
    );

    const client = buildMockSocket(token);
    const deps = buildMockDeps();

    await handleTelemetryConnectionCompat({
      client: client as never,
      ...deps,
    });

    expect(client['workflowRunId']).toBe('workflow-run-1');
  });

  it('falls back to chatSessionId for ad-hoc chat session JWTs', async () => {
    const token = jwtLib.sign(
      {
        chatSessionId: 'chat-session-abc',
        role: 'ui',
      },
      JWT_SECRET,
    );

    const client = buildMockSocket(token);
    const deps = buildMockDeps();

    await handleTelemetryConnectionCompat({
      client: client as never,
      ...deps,
    });

    expect(client['chatSessionId']).toBe('chat-session-abc');
    expect(client['workflowRunId']).toBe('chat-session-abc');
  });
});
