import {
  type AgentChatMessage,
  type AnswerQuestionsHandler,
} from "../chat.types";
import { CommandCardMessagePart } from "./CommandCardMessagePart";
import { QuestionMessagePart } from "./QuestionMessagePart";
import { SubagentSpawnMessagePart } from "./SubagentSpawnMessagePart";
import { TextMessagePart } from "./TextMessagePart";
import { ToolCallMessagePart } from "./ToolCallMessagePart";

export interface MessageBodyProps {
  message: AgentChatMessage;
  answeringQuestions?: boolean;
  onAnswerQuestions?: AnswerQuestionsHandler;
}

/**
 * Picks the right child renderer based on the message shape. Branches are
 * checked in priority order:
 *
 * 1. Structured metadata payloads (`tool_call`, `subagent_spawn`,
 *    `command_card`).
 * 2. Inline questions — when the message carries a `questions` array.
 * 3. Plain text — markdown content (default fallback).
 *
 * Note: legacy tool-call details (category=tool + detailsContent + no
 * `tool_call` metadata) are rendered by `MessageBubble` in the trailing
 * attachments-and-details section, not here.
 */
export function MessageBody({
  message,
  answeringQuestions,
  onAnswerQuestions,
}: Readonly<MessageBodyProps>) {
  const { metadata } = message;

  if (metadata?.type === "tool_call") {
    return <ToolCallMessagePart toolCall={metadata} />;
  }
  if (metadata?.type === "subagent_spawn") {
    return <SubagentSpawnMessagePart metadata={metadata} />;
  }
  if (metadata?.type === "command_card") {
    return <CommandCardMessagePart model={metadata.model} />;
  }

  if (message.questions && message.questions.length > 0) {
    return (
      <QuestionMessagePart
        message={message}
        answeringQuestions={answeringQuestions}
        onAnswerQuestions={onAnswerQuestions}
      />
    );
  }

  return <TextMessagePart content={message.content} />;
}