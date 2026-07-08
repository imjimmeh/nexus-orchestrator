/**
 * ACP Message utilities.
 *
 * NOTE: ACP uses a REST/JSON protocol (not JSON-RPC), so these utilities
 * handle message construction and parsing for ACP's HTTP API, not JSON-RPC.
 * If JSON-RPC patterns are needed for ACP in the future, they should be
 * imported from the shared json-rpc module.
 */
import type { AcpMessage } from '@nexus/core';

export function buildAcpUserMessage(params: {
  content: string;
  contentType?: string;
}): AcpMessage {
  return {
    role: 'user',
    content_type: params.contentType ?? 'text/plain',
    content: params.content,
  };
}

export function parseAcpMessages(messages: AcpMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.startsWith('agent/') ? msg.role.slice(6) : msg.role;
      const content =
        msg.content ?? (msg.content_url ? `[content: ${msg.content_url}]` : '');
      return `${role}: ${content}`;
    })
    .join('\n');
}
