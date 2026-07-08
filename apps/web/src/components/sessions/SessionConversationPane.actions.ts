import { useRetryChatSessionNow } from "@/hooks/useChatSessions";
import { useActiveSessionWorkspaceActions } from "@/pages/active-session/ActiveSessionWorkspace.actions";
import { buildAnswerFromMessage } from "./sessionConversationPane.helpers";
import { UserQuestion } from "@/lib/api/settings.types";
import type { QueryClient } from "@tanstack/react-query";

interface SessionConversationPaneActionsParams {
  threadId: string;
  isChatSession: boolean;
  isWorkflowRun: boolean;
  projectId: string | null | undefined;
  message: string;
  setMessage: (value: string) => void;
  pendingQuestions: UserQuestion[] | null;
  queryClient: QueryClient;
}

export function useSessionConversationPaneActions({
  threadId,
  isChatSession,
  isWorkflowRun,
  projectId,
  message,
  setMessage,
  pendingQuestions,
  queryClient,
}: Readonly<SessionConversationPaneActionsParams>) {
  const retryChatSessionNow = useRetryChatSessionNow(
    isChatSession ? threadId : undefined,
  );

  const actionState = useActiveSessionWorkspaceActions({
    isChatSession,
    chatSessionId: isChatSession ? threadId : undefined,
    projectId: isChatSession && projectId ? projectId : undefined,
    targetWorkItemId: null,
    runId: isWorkflowRun ? threadId : undefined,
    workItem: null,
    message,
    conflictGuidance: "",
    setControlNotice: () => {},
    setMessage,
    setConflictGuidance: () => {},
    queryClient,
  });

  const handleSend = (attachmentIds?: string[]) => {
    const answer = buildAnswerFromMessage(pendingQuestions, message);
    if (answer) {
      actionState.onSubmitAnswers(answer);
      return;
    }

    actionState.onInject(attachmentIds);
  };

  return {
    actionState,
    handleSend,
    retryChatSessionNow,
  };
}
