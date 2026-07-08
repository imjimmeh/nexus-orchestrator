import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserQuestion } from "@/lib/api/settings.types";
import { deepEqual } from "@/lib/deep-equal";
import {
  type AgentChatMessage,
  type AnswerQuestionsHandler,
} from "./chat.types";
export type { AgentChatMessage };
import {
  AgentChatHeader,
  type AgentChatHeaderFooterAction,
  type AgentChatHeaderProps,
  type AgentChatHeaderSecondaryAction,
} from "./AgentChatHeader";
import { AgentChatMessageList } from "./AgentChatMessageList";
import { AgentChatComposer } from "./AgentChatComposer";
import { useChatScroll } from "./hooks/useChatScroll";
import { useChatInput } from "./hooks/useChatInput";

export interface AgentChatPanelProps {
  title: string;
  messages: AgentChatMessage[];
  input: string;
  inputPlaceholder: string;
  onInputChange: (value: string) => void;
  onSend: (attachmentIds?: string[]) => void;
  sendLabel?: string;
  sending?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  agentLabel?: string;
  errorMessage?: string | null;
  onDismissError?: () => void;
  activeQuestions?: UserQuestion[];
  answeringQuestions?: boolean;
  onAnswerQuestions?: AnswerQuestionsHandler;
  secondaryAction?: AgentChatHeaderSecondaryAction;
  footerAction?: AgentChatHeaderFooterAction;
}

function ErrorBanner({
  errorMessage,
  onDismissError,
}: Readonly<{
  errorMessage?: string | null;
  onDismissError?: () => void;
}>) {
  if (!errorMessage) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{errorMessage}</span>
      {onDismissError && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-destructive hover:text-destructive"
          onClick={onDismissError}
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}

function resolveActiveQuestionIds(
  visibleMessages: AgentChatMessage[],
  activeQuestions: UserQuestion[] | undefined,
): Set<string> {
  if (!activeQuestions) {
    return new Set<string>();
  }
  return new Set(
    visibleMessages
      .filter((message) => deepEqual(message.questions, activeQuestions))
      .map((message) => message.id),
  );
}

export function AgentChatPanel({
  title,
  messages,
  input,
  inputPlaceholder,
  onInputChange,
  onSend,
  sendLabel = "Send",
  sending = false,
  disabled = false,
  emptyMessage = "Start the conversation with the agent.",
  agentLabel = "Agent",
  errorMessage,
  onDismissError,
  activeQuestions,
  answeringQuestions,
  onAnswerQuestions,
  secondaryAction,
  footerAction,
}: Readonly<AgentChatPanelProps>) {
  const { messagesContainerRef, messagesEndRef, visibleMessages, onScroll } =
    useChatScroll({ messages, isStreaming: sending });
  const chatInput = useChatInput({
    disabled,
    sending,
    input,
    onSend,
  });

  const activeQuestionMessageIds = useMemo(
    () => resolveActiveQuestionIds(visibleMessages, activeQuestions),
    [visibleMessages, activeQuestions],
  );

  return (
    <div className="flex h-full flex-col">
      <AgentChatHeader
        title={title}
        disabled={disabled}
        secondaryAction={secondaryAction}
        footerAction={footerAction}
      />

      <ErrorBanner
        errorMessage={errorMessage}
        onDismissError={onDismissError}
      />

      <AgentChatMessageList
        messages={messages}
        emptyMessage={emptyMessage}
        agentLabel={agentLabel}
        sending={sending}
        visibleMessages={visibleMessages}
        messagesEndRef={messagesEndRef}
        messagesContainerRef={messagesContainerRef}
        activeQuestionMessageIds={activeQuestionMessageIds}
        answeringQuestions={answeringQuestions}
        onAnswerQuestions={onAnswerQuestions}
        onScroll={onScroll}
      />

      <AgentChatComposer
        input={input}
        inputPlaceholder={inputPlaceholder}
        disabled={disabled}
        sending={sending}
        sendLabel={sendLabel}
        onInputChange={onInputChange}
        attachments={chatInput.uploads}
        uploading={chatInput.uploading}
        onRemoveUpload={chatInput.removeUpload}
        onSend={chatInput.handleSend}
        onAttachClick={chatInput.triggerFilePicker}
        onFileInputChange={chatInput.handleFileInputChange}
        fileInputRef={chatInput.fileInputRef}
        onKeyDown={chatInput.handleKeyDown}
      />
    </div>
  );
}

export type { AgentChatHeaderProps };