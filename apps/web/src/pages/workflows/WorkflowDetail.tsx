import { useEffect, useState } from "react";
import {
  useParams,
  useNavigate,
  useLocation,
  type Location,
} from "react-router-dom";
import { useWorkflow, useWorkflowRuns } from "@/hooks/useWorkflows";
import { useWorkflowRunGraph } from "@/hooks/useWorkflowRunGraph";
import { WorkflowLaunchDialog } from "@/components/workflow/WorkflowLaunchDialog";
import { YamlEditor } from "@/components/workflow/YamlEditor";
import { WorkflowRunContextStrip } from "@/components/workflow/WorkflowRunContextStrip";
import { WorkflowVisualizer } from "@/components/workflow/WorkflowVisualizer";
import { ExecutionLogs } from "@/components/workflow/ExecutionLogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  Play,
  Pencil,
  Loader2,
  AlertCircle,
  CheckCircle2,
  GitFork,
} from "lucide-react";
import { formatDateSafe } from "@/lib/utils";
import { WorkflowLaunchSource } from "@/lib/api/workflow-launch.types";
import { Workflow, WorkflowRun } from "@/lib/api/workflows.types";
import { ScopeBreadcrumb } from "@/components/scope/ScopeBreadcrumb";
import { useScopeContext } from "@/context/ScopeContext";
import { useForkWorkflowForScope } from "@/hooks/useScopedConfig";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { useToast } from "@/hooks/useToast";

type ExecutionNotice = {
  type: "success" | "error";
  message: string;
};

type WorkflowLaunchDraftState = {
  launchDraft?: {
    triggerData: Record<string, unknown>;
    launchSource?: WorkflowLaunchSource;
  };
};

function getContentState(
  isLoadingWorkflow: boolean,
  workflow: ReturnType<typeof useWorkflow>["data"],
): "loading" | "missing" | "ready" {
  if (isLoadingWorkflow) {
    return "loading";
  }

  if (!workflow) {
    return "missing";
  }

  return "ready";
}

function ExecutionNoticeAlert({
  notice,
}: Readonly<{ notice: ExecutionNotice }>) {
  const isError = notice.type === "error";

  return (
    <Alert variant={isError ? "destructive" : "default"}>
      {isError ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      <AlertTitle>
        {isError ? "Execution failed" : "Execution started"}
      </AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}

function LoadingWorkflowDetail() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}

function MissingWorkflowDetail({ onBack }: Readonly<{ onBack: () => void }>) {
  return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <p className="text-muted-foreground">Workflow not found</p>
      <Button onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Workflows
      </Button>
    </div>
  );
}

function WorkflowHeader(
  props: Readonly<{
    workflow: Workflow;
    onBack: () => void;
    onExecute: () => Promise<void>;
    onEdit: () => void;
    isExecuting: boolean;
  }>,
) {
  const { workflow, onBack, onExecute, onEdit, isExecuting } = props;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">
              {workflow.name}
            </h2>
            <Badge variant={workflow.is_active ? "default" : "secondary"}>
              {workflow.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Created{" "}
            {formatDateSafe(workflow.created_at, "MMM d, yyyy", "Unknown date")}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={onExecute}
          disabled={isExecuting || !workflow.is_active}
        >
          {isExecuting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Execute
        </Button>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>
    </div>
  );
}

function WorkflowDetailTabs(
  props: Readonly<{
    activeTab: string;
    onTabChange: (value: string) => void;
    workflow: Workflow;
    graph: ReturnType<typeof useWorkflowRunGraph>["data"];
    isLoadingGraph: boolean;
    graphError: unknown;
    runs: WorkflowRun[];
    selectedRunId?: string;
    onRunChange: (runId: string) => void;
    isLoadingRuns: boolean;
  }>,
) {
  const {
    activeTab,
    onTabChange,
    workflow,
    graph,
    isLoadingGraph,
    graphError,
    runs,
    selectedRunId,
    onRunChange,
    isLoadingRuns,
  } = props;
  const currentRunId = selectedRunId ?? runs[0]?.id;

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
      <TabsList>
        <TabsTrigger value="visualization">Visualization</TabsTrigger>
        <TabsTrigger value="yaml">YAML</TabsTrigger>
        <TabsTrigger value="executions">
          Executions
          {runs.length > 0 && (
            <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
              {runs.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="visualization" className="space-y-6">
        <WorkflowRunContextStrip
          workflowId={workflow.id}
          runs={runs}
          selectedRunId={currentRunId}
          onRunChange={onRunChange}
        />
        <WorkflowVisualizer
          graph={graph}
          isLoading={isLoadingGraph}
          error={graphError}
        />
      </TabsContent>

      <TabsContent value="yaml" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Workflow Definition</CardTitle>
          </CardHeader>
          <CardContent>
            <YamlEditor
              value={workflow.yaml_definition}
              height="600px"
              readOnly
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="executions" className="space-y-6">
        {isLoadingRuns ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <ExecutionLogs runs={runs} workflowId={workflow.id} />
        )}
      </TabsContent>
    </Tabs>
  );
}

export function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation() as Location<WorkflowLaunchDraftState>;
  const { activeScopeNodeId, activeScopePath } = useScopeContext();
  const forkWorkflow = useForkWorkflowForScope();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("visualization");
  const [executionNotice, setExecutionNotice] =
    useState<ExecutionNotice | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState<boolean>(false);
  const [launchDraft, setLaunchDraft] =
    useState<WorkflowLaunchDraftState["launchDraft"]>();

  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(
    id || "",
  );
  const { data: runs = [], isLoading: isLoadingRuns } = useWorkflowRuns({
    workflowId: id,
  });
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const resolvedSelectedRunId =
    selectedRunId && runs.some((run) => run.id === selectedRunId)
      ? selectedRunId
      : runs[0]?.id;
  const {
    data: graph,
    isLoading: isLoadingGraph,
    error: graphError,
  } = useWorkflowRunGraph({
    workflowId: id || "",
    runId: resolvedSelectedRunId,
  });

  useEffect(() => {
    if (!runs.length) {
      if (selectedRunId) {
        setSelectedRunId(undefined);
      }

      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!location.state?.launchDraft) {
      return;
    }

    setLaunchDraft(location.state.launchDraft);
    setLaunchDialogOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const handleExecute = async () => {
    setExecutionNotice(null);
    setLaunchDraft(undefined);
    setLaunchDialogOpen(true);
  };

  const handleEdit = () => {
    if (id) {
      navigate(`/workflows/${id}/edit`);
    }
  };

  const handleBack = () => {
    navigate("/workflows");
  };

  const handleForkWorkflow = async (scopeLabel: string) => {
    if (!workflow) return;
    try {
      await forkWorkflow.mutateAsync({
        baseWorkflowId: workflow.id,
        scopeNodeId: activeScopeNodeId,
        yamlDefinition: workflow.yaml_definition,
      });
      toast.success("Override created", `Forked for ${scopeLabel}.`);
    } catch {
      toast.error("Fork failed", "Could not create the scope override.");
    }
  };

  const contentState = getContentState(isLoadingWorkflow, workflow);

  if (contentState === "loading") {
    return <LoadingWorkflowDetail />;
  }

  if (contentState === "missing") {
    return <MissingWorkflowDetail onBack={handleBack} />;
  }

  if (!workflow) {
    return null;
  }

  return (
    <div className="space-y-6">
      <ScopeBreadcrumb />

      <WorkflowHeader
        workflow={workflow}
        onBack={handleBack}
        onExecute={handleExecute}
        onEdit={handleEdit}
        isExecuting={false}
      />

      {activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            ↑ Platform default — inherited by active scope.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              void handleForkWorkflow(
                activeScopePath[activeScopePath.length - 1],
              );
            }}
            disabled={forkWorkflow.isPending}
          >
            <GitFork className="mr-2 h-3.5 w-3.5" />
            Fork override for {activeScopePath[activeScopePath.length - 1]}
          </Button>
        </div>
      )}

      {executionNotice && <ExecutionNoticeAlert notice={executionNotice} />}

      <WorkflowLaunchDialog
        open={launchDialogOpen}
        onOpenChange={setLaunchDialogOpen}
        workflowId={workflow.id}
        workflowName={workflow.name}
        initialTriggerData={launchDraft?.triggerData}
        defaultLaunchSource={launchDraft?.launchSource}
        onLaunched={({ runId }) => {
          setSelectedRunId(runId ?? undefined);
          setExecutionNotice({
            type: "success",
            message: "Workflow execution started successfully.",
          });
          setLaunchDraft(undefined);
        }}
      />

      <WorkflowDetailTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        workflow={workflow}
        graph={graph}
        isLoadingGraph={isLoadingGraph}
        graphError={graphError}
        runs={runs}
        selectedRunId={resolvedSelectedRunId}
        onRunChange={setSelectedRunId}
        isLoadingRuns={isLoadingRuns}
      />
    </div>
  );
}
