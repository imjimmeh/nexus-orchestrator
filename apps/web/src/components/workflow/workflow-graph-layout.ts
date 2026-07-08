import { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api/workflows.types";

interface GraphMaps {
  levelMap: Map<string, number>;
  inbound: Map<string, number>;
  outgoing: Map<string, string[]>;
}

function initializeGraphMaps(jobNodes: WorkflowGraphNode[]): GraphMaps {
  const levelMap = new Map<string, number>();
  const inbound = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const jobNode of jobNodes) {
    levelMap.set(jobNode.id, 0);
    inbound.set(jobNode.id, 0);
    outgoing.set(jobNode.id, []);
  }

  return { levelMap, inbound, outgoing };
}

function isJobDependencyEdge(
  edge: WorkflowGraphEdge,
  levelMap: Map<string, number>,
): boolean {
  return (
    (edge.kind === "depends_on" || edge.kind === "transition") &&
    levelMap.has(edge.source) &&
    levelMap.has(edge.target)
  );
}

function appendOutgoing(
  outgoing: Map<string, string[]>,
  source: string,
  target: string,
): void {
  const current = outgoing.get(source) ?? [];
  current.push(target);
  outgoing.set(source, current);
}

function applyDependencies(edges: WorkflowGraphEdge[], maps: GraphMaps): void {
  for (const edge of edges) {
    if (!isJobDependencyEdge(edge, maps.levelMap)) {
      continue;
    }

    appendOutgoing(maps.outgoing, edge.source, edge.target);
    maps.inbound.set(edge.target, (maps.inbound.get(edge.target) ?? 0) + 1);
  }
}

function collectZeroInboundNodes(inbound: Map<string, number>): string[] {
  const queue: string[] = [];

  for (const [nodeId, degree] of inbound.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  return queue;
}

function updateTargetLevel(
  levelMap: Map<string, number>,
  sourceId: string,
  targetId: string,
): void {
  const sourceLevel = levelMap.get(sourceId) ?? 0;
  const targetLevel = levelMap.get(targetId) ?? 0;
  levelMap.set(targetId, Math.max(targetLevel, sourceLevel + 1));
}

function walkTopologicalLevels(maps: GraphMaps): void {
  const queue = collectZeroInboundNodes(maps.inbound);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      return;
    }

    const nextNodes = maps.outgoing.get(nodeId) ?? [];
    for (const targetId of nextNodes) {
      updateTargetLevel(maps.levelMap, nodeId, targetId);
      maps.inbound.set(targetId, (maps.inbound.get(targetId) ?? 1) - 1);
      if ((maps.inbound.get(targetId) ?? 0) === 0) {
        queue.push(targetId);
      }
    }
  }
}

function groupJobsByLevel(
  jobNodes: WorkflowGraphNode[],
  levelMap: Map<string, number>,
): Map<number, string[]> {
  const groupedByLevel = new Map<number, string[]>();

  for (const jobNode of jobNodes) {
    const level = levelMap.get(jobNode.id) ?? 0;
    const levelGroup = groupedByLevel.get(level) ?? [];
    levelGroup.push(jobNode.id);
    groupedByLevel.set(level, levelGroup);
  }

  return groupedByLevel;
}

function assignPositionsByLevel(
  groupedByLevel: Map<number, string[]>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const levels = Array.from(groupedByLevel.keys()).sort((a, b) => a - b);

  for (const level of levels) {
    const group = groupedByLevel.get(level) ?? [];
    group.sort((left, right) => left.localeCompare(right));

    for (const [index, nodeId] of group.entries()) {
      positions.set(nodeId, {
        x: level * 360,
        y: index * 240,
      });
    }
  }

  return positions;
}

export function buildJobLayout(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Map<string, { x: number; y: number }> {
  const jobNodes = nodes.filter((node) => node.kind === "job");
  const maps = initializeGraphMaps(jobNodes);

  applyDependencies(edges, maps);
  walkTopologicalLevels(maps);

  const groupedByLevel = groupJobsByLevel(jobNodes, maps.levelMap);
  return assignPositionsByLevel(groupedByLevel);
}
