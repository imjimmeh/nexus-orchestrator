import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import axios from "axios";
import { WorkflowEditorHeader } from "./WorkflowEditorHeader";
import { WorkflowEditorNodePalette } from "./WorkflowEditorNodePalette";
import { WorkflowEditorCanvas } from "./WorkflowEditorCanvas";
import { WorkflowEditorPropertiesPanel } from "./WorkflowEditorPropertiesPanel";
import { WorkflowEditorToolbar } from "./WorkflowEditorToolbar";
import { WorkflowEditorYamlPreview } from "./WorkflowEditorYamlPreview";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import type {
  EditorAction,
  WorkflowEditorState,
} from "./hooks/useWorkflowEditorStore.types";
import { parseYamlToGraph } from "./serialization/yaml-to-graph";
import { serializeGraphToYaml } from "./serialization/graph-to-yaml";
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
} from "@/hooks/useWorkflows";
import { workflowFilesClient } from "@/lib/api/client.workflow-files";
import { JobNode } from "./nodes/JobNode";
import { StepNode } from "./nodes/StepNode";
import { edgeTypes } from "./edges/edge-types";
import { buildJobLayout } from "@/components/workflow/workflow-graph-layout";
import { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api/workflows.types";
import type {
  JobNode as JobNodeType,
  StepNode as StepNodeType,
  WorkflowEdge,
} from "./serialization/types";

const nodeTypes = { job: JobNode, step: StepNode };

type ParsedWorkflow = ReturnType<typeof parseYamlToGraph>;

function resetStoreFromParsedWorkflow(
  parsed: ParsedWorkflow,
  workflowId = parsed.metadata.workflowId,
) {
  useWorkflowEditorStore.getState().resetState({
    workflowId,
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    active: parsed.metadata.active,
    trigger: parsed.metadata.trigger,
    concurrency: parsed.metadata.concurrency,
    permissions: parsed.metadata.permissions,
    globalEnv: parsed.metadata.globalEnv,
    strictDependencies: parsed.metadata.strictDependencies,
    nodes: parsed.nodes,
    edges: parsed.edges,
  });
}

function serializeWorkflowState(state: WorkflowEditorState) {
  return serializeGraphToYaml({
    metadata: {
      workflowId: state.workflowId,
      name: state.name,
      description: state.description,
      trigger: state.trigger,
      concurrency: state.concurrency,
      permissions: state.permissions,
      globalEnv: state.globalEnv,
      strictDependencies: state.strictDependencies,
      active: state.active,
    },
    nodes: state.nodes as Array<JobNodeType | StepNodeType>,
    edges: state.edges as WorkflowEdge[],
  });
}

function extractValidationErrors(error: unknown) {
  if (!axios.isAxiosError(error) || !error.response) {
    return null;
  }

  const status = error.response.status;
  if (status !== 400 && status !== 422) {
    return null;
  }

  const apiErrors: Array<{ path?: string; message?: string }> | undefined =
    error.response.data?.error?.details?.errors;
  if (!Array.isArray(apiErrors)) {
    return null;
  }

  const validationErrors: Record<string, string> = {};
  for (const err of apiErrors) {
    if (err.path && err.message) {
      validationErrors[err.path] = err.message;
    }
  }

  return validationErrors;
}

function makeAutoLayoutUndoAction(
  positionsToApply: Map<string, { x: number; y: number }>,
  positionsToRestore: Map<string, { x: number; y: number }>,
  throwOnNext: boolean,
): EditorAction {
  return {
    type: "move_node",
    payload: { positions: positionsToApply },
    inverse: () => {
      if (throwOnNext) {
        throw new Error("should not loop");
      }
      const state = useWorkflowEditorStore.getState();
      const restored = state.nodes.map((n) => {
        const pos = positionsToRestore.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      state.setNodes(restored);
      return makeAutoLayoutUndoAction(
        positionsToRestore,
        positionsToApply,
        true,
      );
    },
  };
}

function convertToLayoutGraph(
  nodes: Node[],
  edges: Array<{
    id: string;
    source: string;
    target: string;
    data?: Record<string, unknown>;
  }>,
): { layoutNodes: WorkflowGraphNode[]; layoutEdges: WorkflowGraphEdge[] } {
  const layoutNodes: WorkflowGraphNode[] = nodes.map((n) => ({
    id: n.id,
    label:
      ((n.data as Record<string, unknown> | undefined)?.label as string) ??
      n.id,
    kind: n.type === "job" ? "job" : "step",
    status: "idle",
  }));

  const EDGE_KIND_MAP: Record<string, WorkflowGraphEdge["kind"]> = {
    dependency: "depends_on",
    transition: "transition",
  };

  const layoutEdges: WorkflowGraphEdge[] = [];
  for (const e of edges) {
    const kind =
      EDGE_KIND_MAP[
        ((e.data as Record<string, unknown> | undefined)?.kind as
          | string
          | undefined) ?? ""
      ];
    if (kind) {
      layoutEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        kind,
      });
    }
  }

  return { layoutNodes, layoutEdges };
}

interface WorkflowEditorPageProps {
  isEditMode: boolean;
  repoMode?: boolean;
  repoFilename?: string;
}

export function WorkflowEditorPage({
  isEditMode,
  repoMode = false,
  repoFilename,
}: WorkflowEditorPageProps) {
  const {
    id,
    projectId,
    filename: urlFilename,
  } = useParams<{ id?: string; projectId?: string; filename?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const effectiveFilename = repoFilename ?? urlFilename;

  const { data: workflow } = useWorkflow(id ?? "");
  const { mutateAsync: createWorkflow } = useCreateWorkflow();
  const { mutateAsync: updateWorkflow } = useUpdateWorkflow();

  useEffect(() => {
    if (!isEditMode) {
      useWorkflowEditorStore.getState().resetState({});
    }
    return () => {
      useWorkflowEditorStore.getState().resetState({});
    };
  }, [isEditMode]);

  useEffect(() => {
    if (isEditMode && workflow?.yaml_definition) {
      const parsed = parseYamlToGraph(workflow.yaml_definition);
      resetStoreFromParsedWorkflow(parsed, workflow.id);
    }
  }, [isEditMode, workflow]);

  useEffect(() => {
    if (!repoMode || !projectId || !effectiveFilename) return;

    const template = (location.state as Record<string, unknown> | null)
      ?.template as string | undefined;
    if (template) {
      const parsed = parseYamlToGraph(template);
      resetStoreFromParsedWorkflow(parsed);
      window.history.replaceState({}, document.title);
      return;
    }

    let cancelled = false;
    workflowFilesClient
      .read(projectId, effectiveFilename)
      .then(({ content }) => {
        if (cancelled) return;
        const parsed = parseYamlToGraph(content);
        resetStoreFromParsedWorkflow(parsed);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Failed to load workflow file:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoMode, projectId, effectiveFilename, location.state]);

  useEffect(() => {
    const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag && INPUT_TAGS.has(tag)) return;

      const isControl = e.ctrlKey || e.metaKey;

      if (isControl && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        useWorkflowEditorStore.getState().undo();
      } else if (isControl && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        useWorkflowEditorStore.getState().redo();
      } else if (isControl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useWorkflowEditorStore.getState().redo();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const state = useWorkflowEditorStore.getState();
      const yaml = serializeWorkflowState(state);

      if (repoMode && projectId) {
        const saveFilename =
          effectiveFilename || `${state.name || "untitled"}.workflow.yaml`;
        await workflowFilesClient.write(
          projectId,
          saveFilename,
          yaml,
          `docs(workflows): update ${saveFilename}`,
        );
      } else if (isEditMode && state.workflowId) {
        await updateWorkflow({
          id: state.workflowId,
          data: {
            name: state.name,
            yaml_definition: yaml,
            is_active: state.active,
          },
        });
      } else {
        await createWorkflow({
          name: state.name,
          yaml_definition: yaml,
          is_active: state.active,
        });
      }
      useWorkflowEditorStore.getState().clearValidationErrors();
      useWorkflowEditorStore.getState().markClean();
    } catch (error) {
      const validationErrors = extractValidationErrors(error);
      if (validationErrors) {
        useWorkflowEditorStore.getState().setValidationErrors(validationErrors);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    isEditMode,
    repoMode,
    projectId,
    effectiveFilename,
    createWorkflow,
    updateWorkflow,
  ]);

  const handleCancel = useCallback(() => {
    if (repoMode && projectId) {
      navigate(`/projects/${projectId}`);
    } else {
      navigate("/workflows");
    }
  }, [navigate, repoMode, projectId]);

  const handleAutoLayout = useCallback(() => {
    const state = useWorkflowEditorStore.getState();
    const { nodes, edges } = state;

    const { layoutNodes, layoutEdges } = convertToLayoutGraph(nodes, edges);
    const positions = buildJobLayout(layoutNodes, layoutEdges);

    const oldPositions = new Map(nodes.map((n) => [n.id, { ...n.position }]));

    const newNodes = nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });

    state.setNodes(newNodes);
    state.pushAction(
      makeAutoLayoutUndoAction(new Map(positions), oldPositions, false),
    );

    fitView({ duration: 300 });
  }, [fitView]);

  const handleToggleYamlPreview = useCallback(() => {
    setShowYaml((prev) => !prev);
  }, []);

  return (
    <div
      className="flex flex-col h-full"
      data-yaml-preview={showYaml ? "visible" : "hidden"}
    >
      <WorkflowEditorHeader
        onSave={handleSave}
        onCancel={handleCancel}
        isSaving={isSaving}
        isEditMode={isEditMode}
      />
      <div className="flex-1 overflow-hidden">
        <Group orientation="horizontal">
          <Panel defaultSize={15} minSize={5}>
            <WorkflowEditorNodePalette />
          </Panel>
          <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors" />
          <Panel defaultSize={60} minSize={30}>
            <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
          </Panel>
          <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors" />
          <Panel defaultSize={25} minSize={15}>
            <WorkflowEditorPropertiesPanel
              supportsLifecycleTriggers={repoMode}
            />
          </Panel>
        </Group>
      </div>
      <WorkflowEditorToolbar
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitView={fitView}
        onAutoLayout={handleAutoLayout}
        onToggleYamlPreview={handleToggleYamlPreview}
      />
      <WorkflowEditorYamlPreview isVisible={showYaml} />
    </div>
  );
}
