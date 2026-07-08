import { Card, CardContent } from "@/components/ui/card";
import { AgentChatPanel } from "@/components/chat/AgentChatPanel";
import type { SessionChatMessage } from "@/pages/active-session/active-session.utils.types";

export type WorkflowRunChatTabProps = {
  chatMessages: SessionChatMessage[];
  chatEmptyMessage: string;
  message: string;
  onMessageChange: (value: string) => void;
  onInjectMessage: (attachmentIds?: string[]) => void;
  isInjectingMessage: boolean;
  isInteractive: boolean;
};

export function WorkflowRunChatTab({
  chatMessages,
  chatEmptyMessage,
  message,
  onMessageChange,
  onInjectMessage,
  isInjectingMessage,
  isInteractive,
}: WorkflowRunChatTabProps) {
  return (
    <Card className="h-[720px]">
      <CardContent className="h-full p-0">
        <AgentChatPanel
          title="Workflow Run Chat"
          messages={chatMessages}
          input={message}
          inputPlaceholder="Inject guidance to the running agent"
          onInputChange={onMessageChange}
          onSend={onInjectMessage}
          sendLabel="Send"
          sending={isInjectingMessage}
          disabled={!isInteractive}
          emptyMessage={chatEmptyMessage}
          agentLabel="Agent"
        />
      </CardContent>
    </Card>
  );
}
