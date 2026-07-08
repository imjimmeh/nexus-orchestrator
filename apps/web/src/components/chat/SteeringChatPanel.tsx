import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2 } from "lucide-react";
import { SteeringPlanCard } from "@/components/chat/SteeringPlanCard";
import { SteeringPlan } from "@/lib/api/steering.types";
import { type AgentChatMessage } from "./chat.types";
import { ChatMessageItem } from "./ChatMessageItem";

export type SteeringChatMessage = AgentChatMessage;

interface SteeringChatPanelProps {
  messages: SteeringChatMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sendLabel?: string;
  sending?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  agentLabel?: string;
  errorMessage?: string | null;
  onDismissError?: () => void;
  onApprovePlan: (planId: string) => void;
  onRejectPlan: (planId: string, reason?: string) => void;
  onModifyPlan: (planId: string) => void;
  onClarify?: (question: string) => void;
}

function isSteeringPlanMessage(
  message: SteeringChatMessage,
): message is SteeringChatMessage & {
  metadata: { type: "steering_plan"; plan: SteeringPlan; planId: string };
} {
  return (
    message.role === "agent" &&
    message.metadata !== undefined &&
    message.metadata.type === "steering_plan"
  );
}

function ErrorBanner({
  errorMessage,
  onDismissError,
}: {
  errorMessage?: string | null;
  onDismissError?: () => void;
}) {
  if (!errorMessage) return null;

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

function SteeringMessageItem({
  message,
  agentLabel,
  onApprovePlan,
  onRejectPlan,
  onModifyPlan,
  onClarify,
  disabled,
}: {
  message: SteeringChatMessage;
  agentLabel: string;
  onApprovePlan: (planId: string) => void;
  onRejectPlan: (planId: string, reason?: string) => void;
  onModifyPlan: (planId: string) => void;
  onClarify?: (question: string) => void;
  disabled: boolean;
}) {
  if (isSteeringPlanMessage(message)) {
    const { plan, planId } = message.metadata;
    return (
      <div className="mr-8">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {message.label || agentLabel}
        </p>
        <SteeringPlanCard
          plan={plan}
          onApprove={() => onApprovePlan(planId)}
          onModify={() => onModifyPlan(planId)}
          onReject={() => onRejectPlan(planId)}
          onClarify={onClarify}
          disabled={disabled}
        />
      </div>
    );
  }

  return <ChatMessageItem message={message} agentLabel={agentLabel} />;
}

export function SteeringChatPanel({
  messages,
  input,
  onInputChange,
  onSend,
  sendLabel = "Send",
  sending = false,
  disabled = false,
  emptyMessage = "Start steering the project by describing a change.",
  agentLabel = "CEO",
  errorMessage,
  onDismissError,
  onApprovePlan,
  onRejectPlan,
  onModifyPlan,
  onClarify,
}: Readonly<SteeringChatPanelProps>) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;

    if (isNearBottom || sending) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && input.trim() && !sending) {
        onSend();
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Project Steering</h3>
      </div>

      <ErrorBanner
        errorMessage={errorMessage}
        onDismissError={onDismissError}
      />

      <div
        ref={messagesContainerRef}
        className="flex-1 space-y-3 overflow-y-auto min-w-0 px-4 py-3"
      >
        {messages.length === 0 && !sending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          messages.map((msg) => (
            <SteeringMessageItem
              key={msg.id}
              message={msg}
              agentLabel={agentLabel}
              onApprovePlan={onApprovePlan}
              onRejectPlan={onRejectPlan}
              onModifyPlan={onModifyPlan}
              onClarify={onClarify}
              disabled={disabled}
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

      <div className="border-t px-4 py-3">
        <Textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to change..."
          className="mb-2 min-h-[80px] resize-none"
          disabled={disabled}
        />
        <div className="flex items-center gap-2">
          <Button
            onClick={onSend}
            size="sm"
            disabled={disabled || !input.trim() || sending}
          >
            {sending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Sending...
              </>
            ) : (
              sendLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { type SteeringChatPanelProps };
