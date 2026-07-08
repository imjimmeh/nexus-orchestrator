import { useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AgentChatPanel } from "@/components/chat/AgentChatPanel";
import { SessionsPageHeader } from "@/components/sessions/SessionsPageHeader";
import { SessionsThreadPanel } from "@/components/sessions/SessionsThreadPanel";
import { SessionContextPanel } from "@/components/sessions/SessionContextPanel";
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog";
import { useDebounce } from "@/hooks/useDebounce";
import { useSessionsList } from "@/hooks/useSessionsList";
import { useSessionChat } from "@/hooks/useSessionChat";
import type { SessionThread } from "@/components/sessions/session-thread.types";

export function SessionsListPage() {
  const params = useParams<{ sessionId?: string; runId?: string }>();
  const navigate = useNavigate();
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sessionTypeFilter, setSessionTypeFilter] = useState("all");
  const debouncedSearch = useDebounce(search, 300);

  const selectedKey = useMemo(() => {
    if (params.sessionId) return `chat:${params.sessionId}`;
    if (params.runId) return `workflow:${params.runId}`;
    return null;
  }, [params.sessionId, params.runId]);

  const sessionsData = useSessionsList({
    search: debouncedSearch,
    sessionTypeFilter,
    selectedKey,
  });

  const sessionChat = useSessionChat(sessionsData.selectedThread);

  const handleSelectThread = useCallback(
    (thread: SessionThread) => {
      if (thread.kind === "chat") {
        navigate(`/sessions/${thread.id}`);
      } else {
        navigate(`/sessions?runId=${thread.id}`);
      }
    },
    [navigate],
  );

  const handleSendMessage = useCallback(
    (attachmentIds?: string[]) => {
      const trimmed = message.trim();
      if (
        trimmed &&
        !sessionChat.sendMutation.isPending &&
        sessionsData.selectedThread
      ) {
        sessionChat.sendMutation.mutate({ content: trimmed, attachmentIds });
        setMessage("");
      }
    },
    [message, sessionChat.sendMutation, sessionsData.selectedThread],
  );

  const handleOpenWorkspace = useCallback(() => {
    if (sessionsData.selectedThread) {
      navigate(`/project-workspace?runId=${sessionsData.selectedThread.id}`);
    }
  }, [sessionsData.selectedThread, navigate]);

  return (
    <div className="h-[calc(100vh-7rem)]">
      <SessionsPageHeader
        onNewSession={() => {
          setNewSessionOpen(true);
        }}
      />

      <div className="grid h-[calc(100%-3.5rem)] grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_320px]">
        <SessionsThreadPanel
          threads={sessionsData.threads}
          selectedKey={selectedKey}
          unreadMap={sessionsData.unreadMap}
          loading={sessionsData.loading}
          error={sessionsData.error}
          search={search}
          onSearchChange={setSearch}
          sessionTypeFilter={sessionTypeFilter}
          onFilterChange={setSessionTypeFilter}
          onSelectThread={handleSelectThread}
          onRetry={sessionsData.refetch}
          hasMore={sessionsData.hasMore}
          onLoadMore={sessionsData.loadMore}
        />

        <div className="min-h-0 rounded-lg border">
          {sessionsData.selectedThread ? (
            <AgentChatPanel
              title={sessionsData.selectedThread.title}
              messages={sessionChat.chatMessages}
              input={message}
              inputPlaceholder={
                sessionsData.selectedThread.kind === "chat"
                  ? "Message participants"
                  : "Send guidance to this workflow run"
              }
              onInputChange={setMessage}
              onSend={handleSendMessage}
              sendLabel="Send"
              sending={sessionChat.sendMutation.isPending}
              disabled={false}
              emptyMessage="No messages yet in this session."
              agentLabel="Agent"
              errorMessage={sessionChat.sendError}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              Pick a session from the left to start chatting.
            </div>
          )}
        </div>

        <SessionContextPanel
          selectedThread={sessionsData.selectedThread}
          isAgentChatting={sessionChat.isAgentChatting}
          onOpenWorkspace={handleOpenWorkspace}
        />
      </div>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
      />
    </div>
  );
}
