import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import {
  DiffPanel,
  FileTreePanel,
  TerminalPanel,
} from "@/pages/active-session/ActiveSessionWorkspacePanels";
import { WorkflowRunRuntimeNotice, WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";
import { formatRetryTime } from "./sessionConversationPane.helpers";

interface ExecutionSidebarProps {
  readonly tab: "terminal" | "diff" | "tree";
  readonly onTabChange: (tab: "terminal" | "diff" | "tree") => void;
  readonly onClose: () => void;
  // Optional: fetch data for workflow runs
  readonly terminalChunks?: string[];
  readonly workspaceDiff?: string;
  readonly workspaceTree?: WorkflowWorkspaceTreeNode[];
  readonly diffLoading?: boolean;
  readonly diffError?: string | null;
  readonly treeLoading?: boolean;
  readonly treeError?: string | null;
  readonly runtimeNotice?: WorkflowRunRuntimeNotice | null;
}

function RuntimeNoticeSummary({
  notice,
}: Readonly<{ notice: WorkflowRunRuntimeNotice }>) {
  const retryMetadata = notice.retryMetadata;
  const errorSummary = notice.errorSummary;

  return (
    <div className="border-b bg-amber-50/80 p-3 text-xs text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
      <div className="font-semibold">{notice.title}</div>
      <div className="mt-1 line-clamp-3">{notice.message}</div>
      <div className="mt-2 space-y-1 font-mono">
        {retryMetadata?.nextRetryAt ? (
          <div>Next retry: {formatRetryTime(retryMetadata.nextRetryAt)}</div>
        ) : null}
        {retryMetadata?.attempt !== undefined ? (
          <div>
            Attempt: {retryMetadata.attempt}
            {retryMetadata.maxAttempts !== undefined
              ? `/${retryMetadata.maxAttempts}`
              : ""}
          </div>
        ) : null}
        {retryMetadata?.retryQueueJobId ? (
          <div title={retryMetadata.retryQueueJobId}>
            Queue: {retryMetadata.retryQueueJobId.slice(0, 24)}
          </div>
        ) : null}
        {errorSummary?.eventType ? (
          <div>Failure: {errorSummary.eventType}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ExecutionSidebar(props: Readonly<ExecutionSidebarProps>) {
  const {
    tab,
    onTabChange,
    onClose,
    terminalChunks = [],
    workspaceDiff = "",
    workspaceTree = [],
    diffLoading = false,
    diffError = null,
    treeLoading = false,
    treeError = null,
    runtimeNotice = null,
  } = props;
  return (
    <div className="flex flex-col h-full border-l bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Execution Details</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-6 w-6 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {runtimeNotice ? <RuntimeNoticeSummary notice={runtimeNotice} /> : null}

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as typeof tab)}>
          <TabsList className="w-full rounded-none border-b bg-transparent p-0">
            <TabsTrigger value="terminal" className="rounded-none">
              Terminal
            </TabsTrigger>
            <TabsTrigger value="diff" className="rounded-none">
              Diff
            </TabsTrigger>
            <TabsTrigger value="tree" className="rounded-none">
              Files
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-hidden">
            <TabsContent value="terminal" className="h-full m-0">
              {terminalChunks.length > 0 ? (
                <TerminalPanel chunks={terminalChunks} />
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No terminal output yet
                </div>
              )}
            </TabsContent>
            <TabsContent value="diff" className="h-full m-0">
              <DiffPanel
                diff={workspaceDiff}
                isLoading={diffLoading}
                error={diffError}
              />
            </TabsContent>
            <TabsContent value="tree" className="h-full m-0">
              <FileTreePanel
                nodes={workspaceTree}
                isLoading={treeLoading}
                error={treeError}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
