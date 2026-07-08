import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { SessionThreadList } from "../../components/sessions/SessionThreadList";
import { SessionConversationPane } from "../../components/sessions/SessionConversationPane";
import { ExecutionSidebar } from "../../components/sessions/ExecutionSidebar";
import { SubagentExecutionPanel } from "../../components/sessions/SubagentExecutionPanel";
import { NewSessionDialog } from "@/components/sessions";
import { useWorkspaceArtifacts } from "@/pages/active-session/ActiveSessionWorkspace.actions";
import { useUnreadThreads } from "@/hooks/useUnreadThreads";
import { useExecutionSidebarData } from "@/hooks/useExecutionSidebarData";
import type { SessionThread } from "../../components/sessions/session-thread.types";

type ExecutionTab = "terminal" | "diff" | "tree";

interface SessionInboxLayoutParams {
  requestedThreadId: string | null;
  handleThreadSelect: (thread: SessionThread) => void;
  handleThreadResolve: (thread: SessionThread | null) => void;
  unreadMap: Map<string, boolean>;
  onNewSession: () => void;
  newSessionOpen: boolean;
  onNewSessionOpenChange: (open: boolean) => void;
  centerPaneContent: ReactNode;
  isWorkflowRun: boolean;
  selectedThreadId: string | null;
  showExecutionSidebar: boolean;
  executionTab: ExecutionTab;
  setExecutionTab: (tab: ExecutionTab) => void;
  setShowExecutionSidebar: (value: boolean) => void;
  executionData: ReturnType<typeof useExecutionSidebarData>;
}

function renderCenterPaneContent(params: {
  selectedThread: SessionThread | null;
  requestedThreadId: string | null;
  onShowExecution: () => void;
  onMarkAsRead: () => void;
}): ReactNode {
  if (params.selectedThread) {
    return (
      <SessionConversationPane
        threadId={params.selectedThread.id}
        kind={params.selectedThread.kind}
        onShowExecution={params.onShowExecution}
        onMarkAsRead={params.onMarkAsRead}
      />
    );
  }

  if (params.requestedThreadId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Resolving selected session...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <p>Select a chat or workflow to start</p>
    </div>
  );
}

function SessionInboxLayout(
  params: Readonly<SessionInboxLayoutParams>,
): ReactNode {
  return (
    <div className="flex h-screen gap-0 bg-background">
      <div className="w-80 border-r flex flex-col bg-muted/30">
        <SessionThreadList
          selectedThreadId={params.requestedThreadId}
          onThreadSelect={params.handleThreadSelect}
          onThreadResolve={params.handleThreadResolve}
          unreadMap={params.unreadMap}
          onNewSession={params.onNewSession}
        />
      </div>

      <div className="flex-1 flex flex-col">{params.centerPaneContent}</div>

      {params.isWorkflowRun && params.selectedThreadId && (
        <SubagentExecutionPanel workflowRunId={params.selectedThreadId} />
      )}

      {params.selectedThreadId &&
        params.showExecutionSidebar &&
        params.isWorkflowRun && (
          <ExecutionSidebar
            tab={params.executionTab}
            onTabChange={params.setExecutionTab}
            onClose={() => {
              params.setShowExecutionSidebar(false);
            }}
            terminalChunks={params.executionData.terminalChunks}
            workspaceDiff={params.executionData.workspaceDiff}
            workspaceTree={params.executionData.workspaceTree}
            diffLoading={params.executionData.diffLoading}
            diffError={params.executionData.diffError}
            treeLoading={params.executionData.treeLoading}
            treeError={params.executionData.treeError}
            runtimeNotice={params.executionData.runtimeNotice}
          />
        )}

      <NewSessionDialog
        open={params.newSessionOpen}
        onOpenChange={params.onNewSessionOpenChange}
      />
    </div>
  );
}

export function SessionInboxPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [selectedThread, setSelectedThread] = useState<SessionThread | null>(
    null,
  );
  const selectedThreadId = selectedThread?.id ?? null;
  // URL param drives what to display; fall back to state so an already-selected
  // thread stays visible when the route has no :sessionId segment.
  const requestedThreadId = sessionId ?? selectedThreadId ?? null;
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [executionTab, setExecutionTab] = useState<ExecutionTab>("terminal");
  const [showExecutionSidebar, setShowExecutionSidebar] = useState(false);

  // Use the unread state hook for socket integration and persistence
  const { unreadMap, markAsRead } = useUnreadThreads();

  const isWorkflowRun = selectedThread?.kind === "workflow";

  // Fetch workspace artifacts if this is a workflow run
  const workspaceArtifacts = useWorkspaceArtifacts(
    isWorkflowRun && selectedThreadId ? selectedThreadId : undefined,
  );

  // Get execution sidebar data from workflow run telemetry
  const executionData = useExecutionSidebarData(
    isWorkflowRun && selectedThreadId ? selectedThreadId : undefined,
    workspaceArtifacts,
  );

  const handleThreadSelect = useCallback(
    (thread: SessionThread) => {
      setSelectedThread(thread);
      navigate(`/sessions/${thread.id}`, { replace: false });
      markAsRead(thread.id);
    },
    [navigate, markAsRead],
  );

  const handleThreadResolve = useCallback((thread: SessionThread | null) => {
    setSelectedThread(thread);
  }, []);

  const handleMarkAsRead = useCallback(() => {
    if (selectedThreadId) {
      markAsRead(selectedThreadId);
    }
  }, [selectedThreadId, markAsRead]);

  const centerPaneContent = renderCenterPaneContent({
    selectedThread,
    requestedThreadId,
    onShowExecution: () => {
      setShowExecutionSidebar(true);
    },
    onMarkAsRead: handleMarkAsRead,
  });

  // Keep URL in sync when a thread is selected but there is no :sessionId in
  // the route yet (e.g. navigating to /sessions without a suffix).
  useEffect(() => {
    if (selectedThreadId && !sessionId) {
      navigate(`/sessions/${selectedThreadId}`, { replace: false });
    }
  }, [selectedThreadId, sessionId, navigate]);

  return SessionInboxLayout({
    requestedThreadId,
    handleThreadSelect,
    handleThreadResolve,
    unreadMap,
    onNewSession: () => {
      setNewSessionOpen(true);
    },
    newSessionOpen,
    onNewSessionOpenChange: setNewSessionOpen,
    centerPaneContent,
    isWorkflowRun,
    selectedThreadId,
    showExecutionSidebar,
    executionTab,
    setExecutionTab,
    setShowExecutionSidebar,
    executionData,
  });
}
