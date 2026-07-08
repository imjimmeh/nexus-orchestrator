import { Loader2 } from "lucide-react";
import type { RefObject } from "react";
import {
  type AgentChatMessage,
  type AnswerQuestionsHandler,
} from "./chat.types";
import { ChatMessageItem } from "./ChatMessageItem";

export interface AgentChatMessageListProps {
  messages: AgentChatMessage[];
  emptyMessage: string;
  agentLabel: string;
  sending: boolean;
  visibleMessages: AgentChatMessage[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  activeQuestionMessageIds: Set<string>;
  answeringQuestions?: boolean;
  onAnswerQuestions?: AnswerQuestionsHandler;
  onScroll: () => void;
}

export function AgentChatMessageList({
  messages,
  emptyMessage,
  agentLabel,
  sending,
  visibleMessages,
  messagesEndRef,
  messagesContainerRef,
  activeQuestionMessageIds,
  answeringQuestions,
  onAnswerQuestions,
  onScroll,
}: Readonly<AgentChatMessageListProps>) {
  const showEmptyState = messages.length === 0 && !sending;
  return (
    <div
      ref={messagesContainerRef}
      onScroll={onScroll}
      className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
    >
      {showEmptyState ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        visibleMessages.map((chatMessage) => (
          <ChatMessageItem
            key={chatMessage.id}
            answeringQuestions={answeringQuestions}
            message={chatMessage}
            agentLabel={agentLabel}
            onAnswerQuestions={
              activeQuestionMessageIds.has(chatMessage.id)
                ? onAnswerQuestions
                : undefined
            }
          />
        ))
      )}

      {sending && (
        <div className="mr-8 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{agentLabel} is thinking...</span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}