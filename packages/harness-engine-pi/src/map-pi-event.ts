/**
 * Pure function that translates raw pi-coding-agent SDK events into
 * CanonicalSessionEvent shapes understood by the harness runtime kernel.
 *
 * Returns null for events that have no canonical representation so callers
 * can safely ignore unrecognised event types without throwing.
 */

import type { CanonicalSessionEvent } from "@nexus/core";

type RawEvent = Record<string, unknown>;

function extractString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mapTurnStart(stepId: string): CanonicalSessionEvent {
  return { type: "turn_start", stepId };
}

function mapToolExecutionStart(
  raw: RawEvent,
  stepId: string,
  reverseNameMap?: Map<string, string>,
): CanonicalSessionEvent | null {
  const toolCallId = extractString(raw.toolCallId);
  const toolName = extractString(raw.toolName);
  const args = extractRecord(raw.args) ?? {};

  if (!toolCallId || !toolName) return null;

  return {
    type: "tool_execution_start",
    stepId,
    toolCallId,
    toolName: reverseNameMap?.get(toolName) ?? toolName,
    args,
  };
}

function mapToolExecutionUpdate(
  raw: RawEvent,
  stepId: string,
  reverseNameMap?: Map<string, string>,
): CanonicalSessionEvent | null {
  const toolCallId = extractString(raw.toolCallId);
  const toolName = extractString(raw.toolName);

  if (!toolCallId || !toolName) return null;

  return {
    type: "tool_execution_update",
    stepId,
    toolCallId,
    toolName: reverseNameMap?.get(toolName) ?? toolName,
    partialResult: raw.partialResult,
  };
}

function mapToolExecutionEnd(
  raw: RawEvent,
  stepId: string,
  reverseNameMap?: Map<string, string>,
): CanonicalSessionEvent | null {
  const toolCallId = extractString(raw.toolCallId);
  const toolName = extractString(raw.toolName);

  if (!toolCallId || !toolName) return null;

  return {
    type: "tool_execution_end",
    stepId,
    toolCallId,
    toolName: reverseNameMap?.get(toolName) ?? toolName,
    result: raw.result,
    isError: raw.isError === true,
  };
}

function mapTurnEnd(raw: RawEvent, stepId: string): CanonicalSessionEvent {
  const message = extractRecord(raw.message) ?? {};
  const stopReason = extractString(message.stopReason) ?? "end_turn";
  const errorMessage = extractString(message.errorMessage);
  // `text` is the terminal text content carried on the message object by the pi SDK
  const response = extractString(message.text) ?? "";
  const ok =
    !errorMessage && stopReason !== "error" && stopReason !== "aborted";

  return {
    type: "turn_end",
    stepId,
    output: {
      ok,
      response,
      stopReason,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      usage: message.usage,
    },
  };
}

function mapAgentEnd(raw: RawEvent, stepId: string): CanonicalSessionEvent {
  // Extract the terminal response text from the last message in the array if provided
  const messages = Array.isArray(raw.messages)
    ? (raw.messages as unknown[])
    : [];
  const lastMessage = messages.at(-1);
  const response = extractTerminalResponseText(lastMessage) ?? "";

  // Carry stop reason from the message payload when present
  const messageProp = extractRecord(raw.message) ?? {};
  const stopReason = extractString(messageProp.stopReason) ?? "end_turn";

  return {
    type: "agent_end",
    stepId,
    output: { ok: true, response, stopReason },
  };
}

function mapAgentError(raw: RawEvent, stepId: string): CanonicalSessionEvent {
  const error =
    extractString(raw.error) ??
    extractString(raw.message) ??
    "unknown agent error";
  return { type: "agent_error", stepId, error };
}

/**
 * Extract plain text from an AgentMessage object.
 * AssistantMessage has `content: Array<{ type: "text", text: string } | ...>`.
 * Some message shapes carry a top-level `text` or `content` string.
 */
function extractTerminalResponseText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;

  const msg = message as Record<string, unknown>;

  if (Array.isArray(msg.content)) {
    const parts = (msg.content as unknown[])
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string",
      )
      .map((part) => part.text);
    if (parts.length > 0) return parts.join("\n");
  }

  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.content === "string") return msg.content;
  return undefined;
}

const EVENT_MAPPERS: Record<
  string,
  (
    raw: RawEvent,
    stepId: string,
    reverseNameMap?: Map<string, string>,
  ) => CanonicalSessionEvent | null
> = {
  turn_start: (_raw, stepId) => mapTurnStart(stepId),
  tool_execution_start: mapToolExecutionStart,
  tool_execution_update: mapToolExecutionUpdate,
  tool_execution_end: mapToolExecutionEnd,
  turn_end: mapTurnEnd,
  agent_end: mapAgentEnd,
  agent_error: mapAgentError,
};

/**
 * Map a raw pi-coding-agent SDK event to a {@link CanonicalSessionEvent}.
 *
 * @param raw    - The untyped event emitted by the SDK via `session.subscribe`.
 * @param stepId - The workflow step identifier to attach to every canonical event.
 * @param reverseNameMap - Optional map from provider-facing sanitized tool names back to canonical names.
 * @returns The canonical event, or `null` if the event type has no mapping.
 */
export function mapPiEventToCanonical(
  raw: unknown,
  stepId: string,
  reverseNameMap?: Map<string, string>,
): CanonicalSessionEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const event = raw as RawEvent;
  const eventType = extractString(event.type);
  if (!eventType) return null;

  const mapper = EVENT_MAPPERS[eventType];
  if (!mapper) return null;

  return mapper(event, stepId, reverseNameMap);
}
