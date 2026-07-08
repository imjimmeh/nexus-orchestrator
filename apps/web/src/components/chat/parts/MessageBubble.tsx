import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "../chat.types";
import { AttachmentMessagePart } from "./AttachmentMessagePart";
import { ToolCallRenderer } from "../tools/ToolCallRenderer";
import { toLegacyToolCallMetadata } from "../tools/legacy";

function getBubbleClass(message: AgentChatMessage): string {
  if (message.category === "subagent") {
    return "mx-4 border border-cyan-500/30 bg-cyan-50/80";
  }

  if (message.category === "tool") {
    return "mr-8 border border-cyan-500/30 bg-cyan-50/80";
  }

  if (message.category === "thought") {
    return "mr-8 border border-amber-500/30 bg-amber-50/80";
  }

  if (message.category === "question") {
    return "mx-4 border border-violet-500/30 bg-violet-50/80";
  }

  if (message.category === "container") {
    return "mx-4 border border-emerald-500/30 bg-emerald-50/80";
  }

  if (message.category === "system") {
    return "mx-4 border border-border/40 bg-muted/70";
  }

  const role = message.role;
  if (role === "user") {
    return "ml-8 bg-primary/10";
  }

  if (role === "event") {
    return "mx-6 border border-border/70 bg-muted/40";
  }

  return "mr-8 bg-muted";
}

function getMessageLabel(
  message: AgentChatMessage,
  agentLabel: string,
): string {
  if (message.label) {
    return message.label;
  }

  if (message.role === "user") {
    return "You";
  }

  if (message.role === "event") {
    return "Event";
  }

  return agentLabel;
}

function getCollapsedLabel(message: AgentChatMessage): string {
  if (message.category === "tool") {
    return message.content || "Tool";
  }
  if (message.category === "thought") {
    return message.content.split("\n")[0] || "Thought";
  }
  return "Message";
}

function formatTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) {
    return null;
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shouldCollapseByDefault(message: AgentChatMessage): boolean {
  return (
    message.collapsedByDefault === true ||
    message.category === "tool" ||
    message.category === "thought"
  );
}

function MessageHeader({
  messageLabel,
  timestamp,
}: Readonly<{
  messageLabel: string;
  timestamp: string | null;
}>) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        {messageLabel}
      </p>
      {timestamp && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          {timestamp}
        </p>
      )}
    </div>
  );
}

function CollapsedPreview({ collapsedLabel }: Readonly<{ collapsedLabel: string }>) {
  return (
    <p className="truncate text-xs text-muted-foreground">{collapsedLabel}</p>
  );
}

function Expandable({
  canCollapse,
  collapsed,
  collapsedLabel,
  onToggleCollapsed,
  children,
}: Readonly<{
  canCollapse: boolean;
  collapsed: boolean;
  collapsedLabel: string;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
}>) {
  if (!canCollapse) {
    return <>{children}</>;
  }
  return (
    <button
      type="button"
      className="w-full text-left"
      onClick={onToggleCollapsed}
    >
      {collapsed ? <CollapsedPreview collapsedLabel={collapsedLabel} /> : children}
    </button>
  );
}

function MessageAttachmentsAndDetails({
  message,
  collapsed,
}: Readonly<{
  message: AgentChatMessage;
  collapsed: boolean;
}>) {
  if (collapsed) {
    return null;
  }
  return (
    <>
      {message.attachments && message.attachments.length > 0 && (
        <AttachmentMessagePart attachments={message.attachments} />
      )}

      {message.category === "tool" &&
        (!message.metadata || message.metadata.type !== "tool_call") &&
        message.detailsContent && (
          <ToolCallRenderer toolCall={toLegacyToolCallMetadata(message)} />
        )}
    </>
  );
}

export interface MessageBubbleProps {
  message: AgentChatMessage;
  agentLabel: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
}

/**
 * The chat-message bubble chrome: class styling, header label + timestamp,
 * expand/collapse toggle for tool/thought blocks, and the trailing
 * attachments + legacy tool-call details section.
 */
export function MessageBubble({
  message,
  agentLabel,
  collapsed,
  onToggleCollapsed,
  children,
}: Readonly<MessageBubbleProps>) {
  const bubbleClass = getBubbleClass(message);
  const messageLabel = getMessageLabel(message, agentLabel);
  const collapsedLabel = getCollapsedLabel(message);
  const canCollapse = shouldCollapseByDefault(message);
  const timestamp = useMemo(
    () => formatTimestamp(message.timestamp),
    [message.timestamp],
  );

  return (
    <div
      key={message.id}
      className={cn("rounded-lg px-3 py-2 text-sm", bubbleClass)}
    >
      <MessageHeader messageLabel={messageLabel} timestamp={timestamp} />

      <Expandable
        canCollapse={canCollapse}
        collapsed={collapsed}
        collapsedLabel={collapsedLabel}
        onToggleCollapsed={onToggleCollapsed}
      >
        <div className="text-sm">{children}</div>
      </Expandable>

      <MessageAttachmentsAndDetails message={message} collapsed={collapsed} />
    </div>
  );
}