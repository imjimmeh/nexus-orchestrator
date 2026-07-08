import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { WorkflowGraphNode, WorkflowRunGraph } from "@/lib/api/workflows.types";
import type { WorkflowGraphNodePayload } from "./WorkflowGraphNode";

export function stripJobPrefix(nodeId: string): string {
  return nodeId.startsWith("job:") ? nodeId.slice(4) : nodeId;
}

export function getJobLookupKey(node: WorkflowGraphNode): string {
  return stripJobPrefix(node.jobId ?? stripJobPrefix(node.id));
}

export function collectStepsByJob(
  nodes: WorkflowGraphNode[],
): Map<string, WorkflowGraphNode[]> {
  const stepByJob = new Map<string, WorkflowGraphNode[]>();

  for (const node of nodes) {
    if (node.kind !== "step") {
      continue;
    }

    const parentJobId = node.parentJobId ?? node.jobId;
    if (!parentJobId) {
      continue;
    }

    const list = stepByJob.get(stripJobPrefix(parentJobId)) ?? [];
    list.push(node);
    stepByJob.set(stripJobPrefix(parentJobId), list);
  }

  return stepByJob;
}

export function getGraphIdentity(
  graph: WorkflowRunGraph | null | undefined,
): string | null {
  if (!graph) {
    return null;
  }

  return graph.workflowRunId ?? graph.workflowId;
}

export function isVisibleJobId(
  nodeId: string,
  jobIds: Set<string>,
  jobLookupKeys: Set<string>,
): boolean {
  return jobIds.has(nodeId) || jobLookupKeys.has(stripJobPrefix(nodeId));
}

export function createExpandedJobToggle(
  current: Set<string>,
  jobKey: string,
): Set<string> {
  const next = new Set(current);

  if (next.has(jobKey)) {
    next.delete(jobKey);
  } else {
    next.add(jobKey);
  }

  return next;
}

export function toJobFlowNode(
  node: WorkflowGraphNode,
  jobLayout: Map<string, { x: number; y: number }>,
  stepByJob: Map<string, WorkflowGraphNode[]>,
  isExpanded: boolean,
  onToggleExpanded: (() => void) | undefined,
): Node<WorkflowGraphNodePayload> {
  const jobLookupKey = getJobLookupKey(node);
  const hasSteps = (stepByJob.get(jobLookupKey)?.length ?? 0) > 0;

  return {
    id: node.id,
    type: "workflowNode",
    position: jobLayout.get(node.id) ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      kind: node.kind,
      status: node.status,
      jobId: node.jobId,
      stepId: node.stepId,
      parentJobId: node.parentJobId,
      metadata: node.metadata,
      hasSteps,
      isExpanded: hasSteps ? isExpanded : undefined,
      onToggleExpanded: hasSteps ? onToggleExpanded : undefined,
    },
  };
}

export function toStepFlowNode(params: {
  node: WorkflowGraphNode;
  parentPosition: { x: number; y: number };
  siblingIndex: number;
}): Node<WorkflowGraphNodePayload> {
  const { node, parentPosition, siblingIndex } = params;

  return {
    id: node.id,
    type: "workflowNode",
    position: {
      x: (parentPosition?.x ?? 0) + 28,
      y: (parentPosition?.y ?? 0) + 110 + Math.max(siblingIndex, 0) * 96,
    },
    data: {
      label: node.label,
      kind: node.kind,
      status: node.status,
      jobId: node.jobId,
      stepId: node.stepId,
      parentJobId: node.parentJobId,
      metadata: node.metadata,
    },
  };
}

export function toReactFlowEdges(graph: WorkflowRunGraph): Edge[] {
  return graph.edges.map((edge) => {
    const baseEdge: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.kind === "sequence",
      style: {
        strokeWidth: edge.kind === "contains" ? 1 : 1.5,
        strokeDasharray: edge.kind === "contains" ? "4 3" : undefined,
      },
      markerEnd:
        edge.kind === "contains"
          ? undefined
          : {
              type: MarkerType.ArrowClosed,
            },
    };

    return baseEdge;
  });
}
