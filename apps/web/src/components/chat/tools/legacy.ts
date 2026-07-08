import type { SessionChatMessage } from "@/pages/active-session/active-session.utils.types";
import type { AgentChatMessage, ToolCallMetadata } from "../chat.types";

interface RawSection {
  name: string;
  body: string;
}

function splitSections(blob: string): RawSection[] {
  const lines = blob.split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (const line of lines) {
    if (
      line === "Args" ||
      line === "Arg Types" ||
      line === "Partial Result" ||
      line === "Result" ||
      line === "Error Result"
    ) {
      if (current) sections.push(current);
      current = { name: line, body: "" };
    } else if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function tryParse(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractToolNameFromContent(content: string): string {
  const match = content.match(/^(\S+)/);
  return match ? (match[1] as string) : "unknown";
}

function isFailedContent(content: string): boolean {
  return /(\bfailed\b|· failed)/.test(content);
}

export function parseLegacyDetailsBlob(
  message: SessionChatMessage,
): ToolCallMetadata {
  const toolName = extractToolNameFromContent(message.content ?? "");
  const isError = isFailedContent(message.content ?? "");
  const sections = splitSections(message.detailsContent ?? "");
  const argsText = sections.find((s) => s.name === "Args")?.body;
  const resultText = sections.find((s) =>
    isError ? s.name === "Error Result" : s.name === "Result",
  )?.body;

  const argsObj = tryParse(argsText);
  const resultObj = tryParse(resultText);
  const errorText =
    isError &&
    resultObj &&
    typeof (resultObj as Record<string, unknown>).message === "string"
      ? ((resultObj as Record<string, unknown>).message as string)
      : undefined;

  const status: ToolCallMetadata["status"] = "finished";
  const summary = `${toolName} · ${isError ? "✗" : "✓"}`;

  return {
    type: "tool_call",
    toolName,
    callId: `legacy:${message.id}`,
    status,
    summary,
    argsObj,
    partialResults: [],
    resultObj,
    isError,
    errorText,
    startedAt: 0,
  };
}

export function toLegacyToolCallMetadata(
  message: AgentChatMessage,
): ToolCallMetadata {
  return parseLegacyDetailsBlob({
    id: message.id,
    role:
      message.role === "event"
        ? "event"
        : message.role === "user"
          ? "user"
          : "agent",
    content: message.content,
    category: message.category,
    detailsContent: message.detailsContent,
  } as SessionChatMessage);
}
