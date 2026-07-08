import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WorkflowRunGraph } from "@/lib/api/workflows.types";
import {
  WorkflowGraphNode as WorkflowGraphNodeComponent,
  type WorkflowGraphNodePayload,
} from "./WorkflowGraphNode";
import { WorkflowGraphLegend } from "./WorkflowGraphLegend";
import { Loader2 } from "lucide-react";
import { buildJobLayout } from "./workflow-graph-layout";
import {
  collectStepsByJob,
  createExpandedJobToggle,
  getGraphIdentity,
  getJobLookupKey,
  isVisibleJobId,
  toJobFlowNode,
  toReactFlowEdges,
  toStepFlowNode,
} from "./workflow-graph.utils";

interface WorkflowVisualizerProps {
  graph: WorkflowRunGraph | null | undefined;
  isLoading?: boolean;
  error?: unknown;
}

const nodeTypes = {
  workflowNode: WorkflowGraphNodeComponent,
} as NodeTypes;

const EMPTY_EXPANDED_JOB_IDS = new Set<string>();

function EmptyState({ message }: Readonly<{ message: string }>) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-center text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export function WorkflowVisualizer({
  graph,
  isLoading = false,
  error,
}: Readonly<WorkflowVisualizerProps>) {
  const [expansionState, setExpansionState] = useState<{
    graphIdentity: string | null;
    expandedJobIds: Set<string>;
  }>(() => ({
    graphIdentity: getGraphIdentity(graph),
    expandedJobIds: new Set(),
  }));
  const graphIdentity = getGraphIdentity(graph);
  const expandedJobIds =
    expansionState.graphIdentity === graphIdentity
      ? expansionState.expandedJobIds
      : EMPTY_EXPANDED_JOB_IDS;

  useLayoutEffect(() => {
    if (
      expansionState.graphIdentity !== graphIdentity ||
      expansionState.expandedJobIds.size > 0
    ) {
      setExpansionState({
        graphIdentity,
        expandedJobIds: new Set(),
      });
    }
  }, [graphIdentity]);

  const graphView = useMemo(() => {
    if (!graph) {
      return {
        nodes: [] as Node<WorkflowGraphNodePayload>[],
        edges: [] as Edge[],
        expandableJobKeys: [] as string[],
      };
    }

    const jobLayout = buildJobLayout(graph.nodes, graph.edges);
    const stepByJob = collectStepsByJob(graph.nodes);
    const jobNodes = graph.nodes.filter((node) => node.kind === "job");
    const jobIds = new Set(jobNodes.map((node) => node.id));
    const jobLookupKeys = new Set(
      jobNodes.map((node) => getJobLookupKey(node)),
    );
    const expandableJobKeys = jobNodes
      .map((node) => getJobLookupKey(node))
      .filter((jobKey) => (stepByJob.get(jobKey)?.length ?? 0) > 0);
    const expandedJobKeySet = new Set(
      Array.from(expandedJobIds).filter((jobKey) => jobLookupKeys.has(jobKey)),
    );

    const visibleNodes: Node<WorkflowGraphNodePayload>[] = [];

    for (const node of jobNodes) {
      const jobKey = getJobLookupKey(node);
      const hasSteps = (stepByJob.get(jobKey)?.length ?? 0) > 0;
      const isExpanded = hasSteps && expandedJobKeySet.has(jobKey);

      visibleNodes.push(
        toJobFlowNode(
          node,
          jobLayout,
          stepByJob,
          isExpanded,
          hasSteps
            ? () => {
                setExpansionState((current) => {
                  const currentExpandedJobIds =
                    current.graphIdentity === graphIdentity
                      ? current.expandedJobIds
                      : new Set<string>();

                  return {
                    graphIdentity,
                    expandedJobIds: createExpandedJobToggle(
                      currentExpandedJobIds,
                      jobKey,
                    ),
                  };
                });
              }
            : undefined,
        ),
      );

      if (!isExpanded) {
        continue;
      }

      const steps = stepByJob.get(jobKey) ?? [];
      const parentPosition = jobLayout.get(node.id) ?? { x: 0, y: 0 };
      for (const [index, step] of steps.entries()) {
        visibleNodes.push(
          toStepFlowNode({
            node: step,
            parentPosition,
            siblingIndex: index,
          }),
        );
      }
    }

    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = graph.edges.filter((edge) => {
      if (edge.kind === "depends_on" || edge.kind === "transition") {
        return (
          isVisibleJobId(edge.source, jobIds, jobLookupKeys) &&
          isVisibleJobId(edge.target, jobIds, jobLookupKeys)
        );
      }

      return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    });

    return {
      nodes: visibleNodes,
      edges: toReactFlowEdges({ ...graph, edges: visibleEdges }),
      expandableJobKeys,
    };
  }, [expandedJobIds, graph]);

  const handleExpandAll = useCallback(() => {
    setExpansionState({
      graphIdentity,
      expandedJobIds: new Set(graphView.expandableJobKeys),
    });
  }, [graphView.expandableJobKeys]);

  const handleCollapseAll = useCallback(() => {
    setExpansionState({
      graphIdentity,
      expandedJobIds: new Set(),
    });
  }, [graphIdentity]);

  const hasExpandableJobs = graphView.expandableJobKeys.length > 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-56 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <EmptyState message="Failed to load workflow graph." />;
  }

  if (!graph || graphView.nodes.length === 0) {
    return <EmptyState message="No workflow graph data available." />;
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Workflow Graph</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExpandAll}
              disabled={!hasExpandableJobs}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCollapseAll}
              disabled={!hasExpandableJobs}
            >
              Collapse all
            </Button>
          </div>
        </div>
        <WorkflowGraphLegend />
      </CardHeader>
      <CardContent>
        <div className="h-[680px] w-full overflow-hidden rounded-md border">
          <ReactFlow
            nodes={graphView.nodes}
            edges={graphView.edges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  );
}
