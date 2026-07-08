import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { SessionThread } from "./session-thread.types";

interface SessionContextPanelProps {
  readonly selectedThread: SessionThread | null;
  readonly isAgentChatting: boolean;
  readonly onOpenWorkspace: () => void;
  readonly onAbortWorkflowRun?: () => void;
  readonly isAbortWorkflowRunPending?: boolean;
}

function canAbortWorkflowRun(thread: SessionThread): boolean {
  return (
    thread.kind === "workflow" &&
    (thread.status === "RUNNING" || thread.status === "PENDING")
  );
}

export function SessionContextPanel(props: SessionContextPanelProps) {
  const {
    selectedThread,
    isAgentChatting,
    onOpenWorkspace,
    onAbortWorkflowRun,
    isAbortWorkflowRunPending,
  } = props;

  if (!selectedThread) {
    return (
      <Card className="min-h-0">
        <CardHeader>
          <CardTitle className="text-base">Session Panel</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select a session to view details.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle className="text-base">Session Panel</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 overflow-y-auto">
        <Tabs defaultValue="context">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
          <TabsContent value="context" className="space-y-3">
            <div className="space-y-2 text-sm">
              <div>
                <p className="font-medium text-xs text-muted-foreground">
                  Status
                </p>
                <p>{selectedThread.status}</p>
              </div>
              {selectedThread.projectName && (
                <div>
                  <p className="font-medium text-xs text-muted-foreground">
                    Project
                  </p>
                  <p>{selectedThread.projectName}</p>
                </div>
              )}
              {selectedThread.agentProfileName && (
                <div>
                  <p className="font-medium text-xs text-muted-foreground">
                    Agent
                  </p>
                  <p>{selectedThread.agentProfileName}</p>
                </div>
              )}
              {isAgentChatting && (
                <div className="p-2 bg-warning/10 border border-warning/30 rounded text-xs text-warning-foreground">
                  Agent is responding...
                </div>
              )}
              {onAbortWorkflowRun && canAbortWorkflowRun(selectedThread) && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={onAbortWorkflowRun}
                  disabled={isAbortWorkflowRunPending}
                >
                  Abort Run
                </Button>
              )}
            </div>
          </TabsContent>
          <TabsContent value="advanced" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Detailed execution controls are available in the full workspace
              view.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={onOpenWorkspace}
            >
              Open Full Workspace
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
