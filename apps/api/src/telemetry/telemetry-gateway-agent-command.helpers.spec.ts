import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendAgentCommandHelper } from './telemetry-gateway-agent-command.helpers';

function makeMockSocket(overrides: Record<string, unknown> = {}) {
  return {
    role: 'agent',
    workflowRunId: 'run-1',
    stepId: 'step-a',
    containerId: 'container-1',
    emit: vi.fn(),
    connectedAt: Date.now(),
    ...overrides,
  };
}

function makeMockServer(sockets: Array<Record<string, unknown>>) {
  const socketMap = new Map<string, unknown>();
  sockets.forEach((s, i) => socketMap.set(`socket-${i}`, s));
  return {
    sockets: { sockets: socketMap },
  } as any;
}

const logger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

describe('sendAgentCommandHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends command to the matching agent socket', async () => {
    const socket = makeMockSocket();
    const server = makeMockServer([socket]);

    await sendAgentCommandHelper({
      server,
      logger,
      workflowRunId: 'run-1',
      stepId: 'step-a',
      command: { type: 'question_response', answers: [] },
    });

    expect(socket.emit).toHaveBeenCalledWith('command', {
      type: 'question_response',
      answers: [],
    });
  });

  it('prefers the newest socket when multiple match the same runId and stepId', async () => {
    const olderSocket = makeMockSocket({ connectedAt: 1000 });
    const newerSocket = makeMockSocket({ connectedAt: 2000 });
    const server = makeMockServer([olderSocket, newerSocket]);

    await sendAgentCommandHelper({
      server,
      logger,
      workflowRunId: 'run-1',
      stepId: 'step-a',
      command: { type: 'abort' },
    });

    expect(newerSocket.emit).toHaveBeenCalledWith('command', { type: 'abort' });
    expect(olderSocket.emit).not.toHaveBeenCalled();
  });

  it('ignores non-agent sockets', async () => {
    const uiSocket = makeMockSocket({ role: 'ui' });
    const agentSocket = makeMockSocket({ role: 'agent' });
    const server = makeMockServer([uiSocket, agentSocket]);

    await sendAgentCommandHelper({
      server,
      logger,
      workflowRunId: 'run-1',
      stepId: 'step-a',
      command: { type: 'dehydrate' },
    });

    expect(agentSocket.emit).toHaveBeenCalled();
    expect(uiSocket.emit).not.toHaveBeenCalled();
  });

  it('throws when no matching socket is found within timeout', async () => {
    const server = makeMockServer([]);

    await expect(
      sendAgentCommandHelper({
        server,
        logger,
        workflowRunId: 'run-1',
        stepId: 'step-a',
        command: { type: 'abort' },
      }),
    ).rejects.toThrow('No active agent socket found');
  }, 35_000);
});
