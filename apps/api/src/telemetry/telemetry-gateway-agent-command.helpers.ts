import type { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { QuestionResponseAnswer } from './types';

type AuthenticatedSocketLike = Socket & {
  workflowRunId?: string;
  stepId?: string;
  role?: 'agent' | 'ui';
  containerId?: string;
  connectedAt?: number;
};

function asAuthenticatedSocket(socket: Socket): AuthenticatedSocketLike {
  return socket as AuthenticatedSocketLike;
}

type AgentCommandPayload =
  | { type: 'dehydrate' }
  | { type: 'abort' }
  | { type: 'prompt'; message: string }
  | {
      type: 'question_response';
      answers: QuestionResponseAnswer[];
    };

const SOCKET_WAIT_TIMEOUT_MS = 30_000;
const SOCKET_POLL_INTERVAL_MS = 500;

export function findAgentSocket(
  server: Server,
  workflowRunId: string,
  stepId?: string,
): AuthenticatedSocketLike | undefined {
  const sockets = server.sockets.sockets;
  let best: AuthenticatedSocketLike | undefined;
  let bestTime = -1;

  for (const [, socket] of sockets) {
    const candidate = asAuthenticatedSocket(socket);
    if (
      candidate.role === 'agent' &&
      candidate.workflowRunId === workflowRunId &&
      (stepId === undefined || candidate.stepId === stepId)
    ) {
      const connectedAt =
        typeof candidate.connectedAt === 'number' ? candidate.connectedAt : 0;
      if (!best || connectedAt > bestTime) {
        best = candidate;
        bestTime = connectedAt;
      }
    }
  }
  return best;
}

export async function sendAgentCommandHelper(params: {
  server: Server;
  logger: Logger;
  workflowRunId: string;
  stepId?: string;
  command: AgentCommandPayload;
}): Promise<void> {
  const existing = findAgentSocket(
    params.server,
    params.workflowRunId,
    params.stepId,
  );
  if (existing) {
    existing.emit('command', params.command);
    return;
  }

  const target = params.stepId
    ? `${params.workflowRunId}/${params.stepId}`
    : params.workflowRunId;
  params.logger.log(`Waiting for agent socket for ${target}...`);
  const deadline = Date.now() + SOCKET_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, SOCKET_POLL_INTERVAL_MS),
    );
    const found = findAgentSocket(
      params.server,
      params.workflowRunId,
      params.stepId,
    );
    if (found) {
      found.emit('command', params.command);
      return;
    }
  }

  throw new Error(`No active agent socket found for ${target}`);
}

export function sendDehydrateCommandHelper(params: {
  server: Server;
  containerId: string;
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const sockets = params.server.sockets.sockets;
    let targetSocket: AuthenticatedSocketLike | undefined;

    for (const [, socket] of sockets) {
      const candidate = asAuthenticatedSocket(socket);
      if (
        candidate.role === 'agent' &&
        candidate.containerId === params.containerId
      ) {
        targetSocket = candidate;
        break;
      }
    }

    if (!targetSocket) {
      reject(
        new Error(`No agent socket found for container ${params.containerId}`),
      );
      return;
    }

    const timer = setTimeout(() => {
      reject(
        new Error(
          `Dehydrate acknowledgement timed out for container ${params.containerId}`,
        ),
      );
    }, params.timeoutMs);

    const onDehydrated = () => {
      clearTimeout(timer);
      resolve();
    };

    targetSocket.once('dehydrated', onDehydrated);
    targetSocket.emit('command', { type: 'dehydrate' });
  });
}
