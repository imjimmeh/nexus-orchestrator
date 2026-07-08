import { describe, expect, it, vi } from 'vitest';
import { TelemetryAgentCommandService } from './telemetry-agent-command.service';

function makeMockServer() {
  return {
    sockets: { sockets: new Map<string, unknown>() },
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  } as never;
}

function makeMockSocket(overrides: Record<string, unknown> = {}) {
  return {
    role: 'agent',
    workflowRunId: 'run-1',
    stepId: 'step-a',
    containerId: 'container-1',
    emit: vi.fn(),
    once: vi.fn(),
    connectedAt: Date.now(),
    ...overrides,
  };
}

function registerSocket(
  server: ReturnType<typeof makeMockServer>,
  socket: ReturnType<typeof makeMockSocket>,
) {
  (
    server as { sockets: { sockets: Map<string, unknown> } }
  ).sockets.sockets.set(`socket-${Math.random()}`, socket);
}

describe('TelemetryAgentCommandService', () => {
  it('throws when commands are invoked before the server is attached', () => {
    const service = new TelemetryAgentCommandService();
    expect(() => service.hasActiveAgentSocket('run-1')).toThrow(
      /before gateway finished initializing/,
    );
  });

  it('attaches the server and routes hasActiveAgentSocket through it', () => {
    const service = new TelemetryAgentCommandService();
    const server = makeMockServer();
    const socket = makeMockSocket();
    registerSocket(server, socket);

    service.attachServer(server);
    expect(service.hasActiveAgentSocket('run-1', 'step-a')).toBe(true);
    expect(service.hasActiveAgentSocket('run-other')).toBe(false);
  });

  it('forwards sendPromptCommand to the matching agent socket', async () => {
    const service = new TelemetryAgentCommandService();
    const server = makeMockServer();
    const socket = makeMockSocket();
    registerSocket(server, socket);
    service.attachServer(server);

    await service.sendPromptCommand('run-1', 'step-a', 'hello');
    expect(socket.emit).toHaveBeenCalledWith('command', {
      type: 'prompt',
      message: 'hello',
    });
  });

  it('forwards sendAbortCommand with the abort payload', async () => {
    const service = new TelemetryAgentCommandService();
    const server = makeMockServer();
    const socket = makeMockSocket();
    registerSocket(server, socket);
    service.attachServer(server);

    await service.sendAbortCommand('run-1', 'step-a');
    expect(socket.emit).toHaveBeenCalledWith('command', { type: 'abort' });
  });

  it('forwards sendQuestionResponseCommand to the matching agent socket', async () => {
    const service = new TelemetryAgentCommandService();
    const server = makeMockServer();
    const socket = makeMockSocket();
    registerSocket(server, socket);
    service.attachServer(server);

    await service.sendQuestionResponseCommand('run-1', 'step-a', [
      { questionIndex: 0, selectedOption: 'yes', freeTextAnswer: null },
    ]);
    expect(socket.emit).toHaveBeenCalledWith('command', {
      type: 'question_response',
      answers: [
        { questionIndex: 0, selectedOption: 'yes', freeTextAnswer: null },
      ],
    });
  });
});
