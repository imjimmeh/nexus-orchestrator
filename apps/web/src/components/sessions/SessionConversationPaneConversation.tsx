import { AgentChatPanel } from "@/components/chat/AgentChatPanel";
import { AgentTodoPanel } from "@/components/chat/AgentTodoPanel";
import type { ComponentProps } from "react";

type AgentTodoPanelProps = ComponentProps<typeof AgentTodoPanel>;
type AgentChatPanelProps = ComponentProps<typeof AgentChatPanel>;

interface SessionConversationPaneConversationProps {
  agentTodos: AgentTodoPanelProps["todos"];
  messages: AgentChatPanelProps["messages"];
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (attachmentIds?: string[]) => void;
  isSendingInject: boolean;
  isSendingAnswers: boolean;
  isTerminal: boolean;
  isWaitingOnRateLimit: boolean;
  isWaitingOnRetry: boolean;
  isChatSession: boolean;
  pendingQuestions: AgentChatPanelProps["activeQuestions"] | null;
  onAnswerQuestions: AgentChatPanelProps["onAnswerQuestions"];
}

export function SessionConversationPaneConversation({
  agentTodos,
  messages,
  message,
  onMessageChange,
  onSend,
  isSendingInject,
  isSendingAnswers,
  isTerminal,
  isWaitingOnRateLimit,
  isWaitingOnRetry,
  isChatSession,
  pendingQuestions,
  onAnswerQuestions,
}: Readonly<SessionConversationPaneConversationProps>) {
  const inputPlaceholder = isWaitingOnRateLimit
    ? "Waiting for provider rate limit reset..."
    : isWaitingOnRetry
      ? "Waiting for workflow retry to run..."
      : isChatSession
        ? "Send a message..."
        : "Inject guidance to the running agent...";

  return (
    <div className="flex-1 overflow-hidden min-w-0">
      <div className="px-4 pt-4">
        <AgentTodoPanel todos={agentTodos} />
      </div>
      <AgentChatPanel
        title="Conversation"
        messages={messages}
        input={message}
        inputPlaceholder={inputPlaceholder}
        onInputChange={onMessageChange}
        onSend={onSend}
        sendLabel="Send"
        sending={isSendingInject || isSendingAnswers}
        disabled={isTerminal || isWaitingOnRateLimit || isWaitingOnRetry}
        emptyMessage="No conversation yet in this session."
        agentLabel="Agent"
        activeQuestions={pendingQuestions ?? undefined}
        answeringQuestions={isSendingAnswers}
        onAnswerQuestions={onAnswerQuestions}
      />
    </div>
  );
}
