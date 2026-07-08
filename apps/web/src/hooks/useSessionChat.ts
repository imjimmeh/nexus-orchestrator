import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useChatSessionTelemetry } from "@/hooks/useChatSessionTelemetry";
import { useWorkflowRunTelemetry } from "@/hooks/useWorkflowRunTelemetry";
import { toSessionChatMessages } from "@/pages/active-session/active-session.utils";
import type { SessionThread } from "@/components/sessions/session-thread.types";

export function useSessionChat(selectedThread: SessionThread | null) {
  const selectedChatSessionId =
    selectedThread?.kind === "chat" ? selectedThread.id : undefined;
  const selectedRunId =
    selectedThread?.kind === "workflow" ? selectedThread.id : undefined;

  const selectedChatTelemetry = useChatSessionTelemetry(selectedChatSessionId);
  const selectedWorkflowTelemetry = useWorkflowRunTelemetry(selectedRunId);
  const telemetry =
    selectedThread?.kind === "chat"
      ? selectedChatTelemetry
      : selectedWorkflowTelemetry;

  const chatMessages = useMemo(
    () =>
      toSessionChatMessages(telemetry.events, {
        initialUserMessage:
          selectedThread?.kind === "chat"
            ? selectedThread.initialMessage
            : undefined,
      }),
    [selectedThread, telemetry.events],
  );

  const sendMutation = useMutation({
    mutationFn: ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds?: string[];
    }) => {
      if (!selectedThread) throw new Error("No session selected");
      if (selectedThread.kind === "chat") {
        return api.sendChatSessionMessage(
          selectedThread.id,
          content,
          attachmentIds,
        );
      }
      // attachmentIds not yet supported on workflow run injection
      return api.injectWorkflowRunMessage(selectedThread.id, content);
    },
  });

  const sendError = sendMutation.error
    ? getApiErrorMessage(sendMutation.error, "Unable to send message.")
    : null;

  const isAgentChatting = useMemo(() => {
    const latestEvent = telemetry.events[telemetry.events.length - 1];
    return (
      latestEvent?.event_type === "agent_telemetry" &&
      (latestEvent.payload.type === "text_delta" ||
        latestEvent.payload.type === "message_delta")
    );
  }, [telemetry.events]);

  return {
    chatMessages,
    sendMutation,
    sendError,
    isAgentChatting,
    onSendSuccess: () => {
      // called by parent to clear message input
    },
  };
}
