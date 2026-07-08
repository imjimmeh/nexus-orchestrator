import { Injectable, BadRequestException } from '@nestjs/common';
import { IJob } from '@nexus/core';
import { normalizeWorkflowJobNeeds } from './workflow-needs.utils';

@Injectable()
export class DAGResolverService {
  buildDependencyGraph(jobs: IJob[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const jobIds = new Set(jobs.map((j) => j.id));

    this.validateTransitionTargets(jobs, jobIds);

    for (const job of jobs) {
      const explicit = normalizeWorkflowJobNeeds(job).map((need) => need.id);
      for (const dep of explicit) {
        if (!jobIds.has(dep)) {
          throw new BadRequestException(
            `Job ${job.id} depends on unknown job: ${dep}`,
          );
        }
      }

      graph.set(job.id, explicit);
    }

    this.detectCycles(graph);
    return graph;
  }

  private validateTransitionTargets(jobs: IJob[], jobIds: Set<string>): void {
    for (const job of jobs) {
      for (const transition of job.transitions ?? []) {
        if (!jobIds.has(transition.next)) {
          throw new BadRequestException(
            `Job ${job.id} transitions to unknown job: ${transition.next}`,
          );
        }
      }
    }
  }

  detectCycles(graph: Map<string, string[]>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string) => {
      visited.add(node);
      recursionStack.add(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recursionStack.has(neighbor)) {
          throw new BadRequestException(
            `Circular dependency detected involving job: ${neighbor}`,
          );
        }
      }

      recursionStack.delete(node);
    };

    for (const [node] of graph) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  topologicalSort(graph: Map<string, string[]>): string[] {
    const inDegree = this.buildInDegreeMap(graph);
    const reverseGraph = this.buildReverseGraph(graph);
    const queue = this.collectZeroInDegreeNodes(inDegree);
    return this.walkTopologicalOrder(queue, reverseGraph, inDegree);
  }

  private buildInDegreeMap(graph: Map<string, string[]>): Map<string, number> {
    const inDegree = new Map<string, number>();
    for (const [node] of graph) {
      inDegree.set(node, 0);
    }

    for (const [node, dependencies] of graph) {
      inDegree.set(node, dependencies.length);
    }

    return inDegree;
  }

  private buildReverseGraph(
    graph: Map<string, string[]>,
  ): Map<string, string[]> {
    const reverseGraph = new Map<string, string[]>();
    for (const [node] of graph) {
      reverseGraph.set(node, []);
    }

    for (const [node, dependencies] of graph) {
      for (const dependency of dependencies) {
        reverseGraph.get(dependency)?.push(node);
      }
    }

    return reverseGraph;
  }

  private collectZeroInDegreeNodes(inDegree: Map<string, number>): string[] {
    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }
    return queue;
  }

  private walkTopologicalOrder(
    queue: string[],
    reverseGraph: Map<string, string[]>,
    inDegree: Map<string, number>,
  ): string[] {
    const sorted: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      sorted.push(current);
      const neighbors = reverseGraph.get(current) || [];
      for (const neighbor of neighbors) {
        const degree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, degree);
        if (degree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return sorted;
  }

  findParallelJobs(graph: Map<string, string[]>): string[][] {
    const sorted = this.topologicalSort(graph);
    // Basic grouping: nodes with 0 in-degree can run.
    // This is more complex in practice but topological levels give parallel groups.
    const levels = new Map<string, number>();

    for (const node of sorted) {
      const deps = graph.get(node) || [];
      let maxLevel = -1;
      for (const dep of deps) {
        const depLevel = levels.get(dep) ?? -1;
        if (depLevel > maxLevel) {
          maxLevel = depLevel;
        }
      }
      levels.set(node, maxLevel + 1);
    }

    const groups: string[][] = [];
    for (const [node, level] of levels) {
      if (!groups[level]) {
        groups[level] = [];
      }
      groups[level].push(node);
    }

    return groups;
  }
}
