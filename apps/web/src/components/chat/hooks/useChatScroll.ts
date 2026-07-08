import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AgentChatMessage } from "../chat.types";

const DEFAULT_INITIAL_VISIBLE_MESSAGE_COUNT = 50;
const DEFAULT_MESSAGE_LOAD_CHUNK_SIZE = 50;
const DEFAULT_SCROLL_EDGE_THRESHOLD_PX = 100;

function getConversationKey(messages: AgentChatMessage[]): string {
  return messages[0]?.id ?? "empty";
}

function isNearBottom(container: HTMLElement, thresholdPx: number): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    thresholdPx
  );
}

/**
 * Encapsulates auto-scroll, stick-to-bottom, and backwards windowing for the
 * AgentChatPanel message list.
 *
 * Returns the viewport refs, the currently visible (windowed) messages, and
 * a scroll handler to attach to the scroll container. The caller renders the
 * message list and a sentinel end-div against the returned refs.
 */
export function useChatScroll(params: {
  messages: AgentChatMessage[];
  isStreaming: boolean;
}): {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  visibleMessages: AgentChatMessage[];
  onScroll: () => void;
} {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousScrollHeightBeforePrependRef = useRef<number | null>(null);

  const conversationKey = getConversationKey(params.messages);
  const [viewport, setViewport] = useState(() => ({
    conversationKey,
    visibleMessageCount: DEFAULT_INITIAL_VISIBLE_MESSAGE_COUNT,
  }));

  const visibleMessageCount =
    viewport.conversationKey === conversationKey
      ? viewport.visibleMessageCount
      : DEFAULT_INITIAL_VISIBLE_MESSAGE_COUNT;

  const visibleMessages = useMemo(
    () =>
      params.messages.slice(
        -Math.min(visibleMessageCount, params.messages.length),
      ),
    [params.messages, visibleMessageCount],
  );

  useEffect(() => {
    if (viewport.conversationKey === conversationKey) {
      return;
    }
    shouldStickToBottomRef.current = true;
    setViewport({
      conversationKey,
      visibleMessageCount: DEFAULT_INITIAL_VISIBLE_MESSAGE_COUNT,
    });
  }, [conversationKey, viewport.conversationKey]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    const previousScrollHeight =
      previousScrollHeightBeforePrependRef.current;
    if (!container || previousScrollHeight === null) {
      return;
    }
    previousScrollHeightBeforePrependRef.current = null;
    container.scrollTop += container.scrollHeight - previousScrollHeight;
  }, [visibleMessages.length]);

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [params.messages.length, params.isStreaming]);

  const onScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    shouldStickToBottomRef.current = isNearBottom(
      container,
      DEFAULT_SCROLL_EDGE_THRESHOLD_PX,
    );

    const cappedVisibleMessageCount = Math.min(
      visibleMessageCount,
      params.messages.length,
    );
    if (
      container.scrollTop > DEFAULT_SCROLL_EDGE_THRESHOLD_PX ||
      cappedVisibleMessageCount >= params.messages.length
    ) {
      return;
    }

    previousScrollHeightBeforePrependRef.current = container.scrollHeight;
    setViewport({
      conversationKey,
      visibleMessageCount: Math.min(
        params.messages.length,
        cappedVisibleMessageCount + DEFAULT_MESSAGE_LOAD_CHUNK_SIZE,
      ),
    });
  };

  return {
    messagesContainerRef,
    messagesEndRef,
    visibleMessages,
    onScroll,
  };
}