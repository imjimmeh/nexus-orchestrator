import type { SendChatMessageResult } from './chat-messages.types';

export function buildInboundMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | null {
  return metadata ?? null;
}

export function mergeMessageMetadata(
  metadata: Record<string, unknown> | null | undefined,
  additions: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata && !additions) {
    return null;
  }

  if (!metadata) {
    return additions;
  }

  if (!additions) {
    return metadata;
  }

  return {
    ...metadata,
    ...additions,
  };
}

export function mapSendResult(message: {
  id: string;
  run_id?: string | null;
  run_status?: string | null;
}): SendChatMessageResult {
  return {
    acknowledged: true,
    messageId: message.id,
    runId: message.run_id ?? null,
    runStatus: message.run_status ?? null,
  };
}
