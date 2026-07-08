import { useState } from "react";
import {
  type AgentChatMessage,
  type AnswerQuestionsHandler,
} from "./chat.types";
import { MessageBody } from "./parts/MessageBody";
import { MessageBubble } from "./parts/MessageBubble";

export interface ChatMessageItemProps {
  answeringQuestions?: boolean;
  message: AgentChatMessage;
  agentLabel: string;
  onAnswerQuestions?: AnswerQuestionsHandler;
}

/**
 * Thin dispatcher for a single chat message. Owns only the collapsed
 * toggle state; the bubble chrome (class, header, attachments + details)
 * lives in `MessageBubble`, and the body-shape branching lives in
 * `MessageBody`. Each child renderer is responsible for its own logic.
 */
export function ChatMessageItem({
  answeringQuestions,
  message,
  agentLabel,
  onAnswerQuestions,
}: Readonly<ChatMessageItemProps>) {
  const [collapsed, setCollapsed] = useState(
    message.collapsedByDefault ?? false,
  );

  return (
    <MessageBubble
      message={message}
      agentLabel={agentLabel}
      collapsed={collapsed}
      onToggleCollapsed={() => {
        setCollapsed((current) => !current);
      }}
    >
      <MessageBody
        message={message}
        answeringQuestions={answeringQuestions}
        onAnswerQuestions={onAnswerQuestions}
      />
    </MessageBubble>
  );
}