import { dump } from "js-yaml";
import type {
  IWorkflowTransition,
  WorkflowNeed,
  WorkflowNeedObject,
  WorkflowSwitchCase,
  WorkflowSwitchDefault,
} from "@nexus/core";
import { dropUndefined } from "./utils";
import {JobNode, ParsedWorkflow, StepNode, WorkflowEdge} from "./types";

export function serializeGraphToYaml(params: {
  metadata: ParsedWorkflow["metadata"];
  nodes: Array<JobNode | StepNode>;
  edges: WorkflowEdge[];
}): string {
  const jobNodes = params.nodes.filter(isJobNode);
  const jobIds = new Set(jobNodes.map((node) => node.id));
  const stepNodesByJobId = groupStepNodes(params.nodes.filter(isStepNode));
  const jobs = jobNodes.map((node) =>
    buildJob(node, stepNodesByJobId.get(node.id) ?? [], params.edges, jobIds),
  );
  const workflow = dropUndefined({
    workflow_id: params.metadata.workflowId,
    name: params.metadata.name,
    description: optionalString(params.metadata.description),
    trigger: params.metadata.trigger ?? undefined,
    concurrency: params.metadata.concurrency ?? undefined,
    permissions: params.metadata.permissions ?? undefined,
    global_env: optionalRecord(params.metadata.globalEnv),
    strict_dependencies: params.metadata.strictDependencies ? true : undefined,
    active: params.metadata.active,
    jobs,
  });
  return dump(workflow, { noRefs: true, lineWidth: -1 });
}

function buildJob(
  node: JobNode,
  stepNodes: StepNode[],
  edges: WorkflowEdge[],
  jobIds: Set<string>,
): Record<string, unknown> {
  const data = node.data;
  const job = dropUndefined({
    type: data.jobType,
    tier: data.tier,
    condition: data.condition,
    inputs: data.inputs,
    permissions: data.permissions,
    host_mounts: data.hostMounts,
    transitions: mergeTransitions(
      nonJobTargetTransitions(data.transitions ?? [], jobIds),
      edgeTransitions(node.id, edges),
    ),
    switch: edgeSwitchCases(node.id, edges),
    default: edgeSwitchDefault(node.id, edges),
    max_retries: data.maxRetries,
    retry_prompt: data.retryPrompt,
    output_contract: data.outputContract,
    max_step_loops: data.maxStepLoops,
    workflow_id: data.targetWorkflowId,
    wait_for_completion: data.waitForCompletion,
    command: data.command,
    working_dir: data.workingDir,
    timeout_ms: data.timeoutMs,
    event_name: data.eventName,
    payload: data.payload,
    url: data.url,
    method: data.method,
    headers: data.headers,
    body: data.body,
    allowed_urls: data.allowedUrls,
    action: data.action,
    server_id: data.serverId,
    tool_name: data.toolName,
    params: data.params,
    allowed_servers: data.allowedServers,
    allowed_tools: data.allowedTools,
    repository_id: data.repositoryId,
    tool_schema: data.toolSchema,
    typescript_code: data.typescriptCode,
    tier_restriction: data.tierRestriction,
    artifact_id: data.artifactId,
    depends_on: dependencySources(node.id, edges),
    needs: dependencyNeeds(node.id, edges),
    strict_dependencies: data.strictDependencies,
    continue_on_error: data.continueOnError,
    continue_on_concurrency_skip: data.continueOnConcurrencySkip,
    for_each: data.forEach,
    steps: stepNodes.length > 0 ? stepNodes.map(buildStep) : undefined,
  });
  return { id: data.jobId, ...job };
}

function buildStep(node: StepNode): Record<string, unknown> {
  const data = node.data;
  return dropUndefined({
    id: data.stepId,
    type: data.stepType,
    prompt: data.prompt,
    prompt_file: data.promptFile,
    prompt_mode: data.promptMode,
    harness_id: data.harnessId,
    command: data.command,
    working_dir: data.workingDir,
    variables: data.variables,
    timeout_ms: data.timeoutMs,
    needs: data.needs,
    if: data.if,
    max_loops: data.maxLoops,
    transitions: data.transitions,
    on_error: data.onError,
  });
}

function dependencySources(
  jobNodeId: string,
  edges: WorkflowEdge[],
): string[] | undefined {
  const sources = edges
    .filter(
      (edge) =>
        edge.target === jobNodeId &&
        edge.data?.kind === "dependency" &&
        !edge.data.resultPolicy &&
        edge.data.optional === undefined,
    )
    .map((edge) => edge.source);
  const merged = sources.filter(uniqueValue);
  return merged.length > 0 ? merged : undefined;
}

function dependencyNeeds(
  jobNodeId: string,
  edges: WorkflowEdge[],
): WorkflowNeed[] | undefined {
  const policyNeeds = edges.flatMap((edge) => {
    if (edge.target !== jobNodeId || edge.data?.kind !== "dependency")
      return [];
    if (!edge.data.resultPolicy && edge.data.optional === undefined) return [];
    const need: WorkflowNeedObject = dropUndefined({
      job: edge.source,
      result: edge.data.resultPolicy,
      optional: edge.data.optional,
    });
    return [need];
  });
  const merged: WorkflowNeed[] = [];
  policyNeeds.forEach((need) => {
    if (!merged.some((existing) => dependenciesEqual(existing, need)))
      merged.push(need);
  });
  return merged.length > 0 ? merged : undefined;
}

function edgeTransitions(
  jobNodeId: string,
  edges: WorkflowEdge[],
): IWorkflowTransition[] {
  return edges.flatMap((edge) => {
    if (edge.source !== jobNodeId || edge.data?.kind !== "transition")
      return [];
    return [{ condition: edge.data.condition, next: edge.target }];
  });
}

function nonJobTargetTransitions(
  transitions: IWorkflowTransition[],
  jobIds: Set<string>,
): IWorkflowTransition[] {
  return transitions.filter((transition) => !jobIds.has(transition.next));
}

function mergeTransitions(
  existing: IWorkflowTransition[],
  fromEdges: IWorkflowTransition[],
): IWorkflowTransition[] | undefined {
  const merged = [...existing];
  fromEdges.forEach((transition) => {
    if (
      !merged.some(
        (item) =>
          item.condition === transition.condition &&
          item.next === transition.next,
      )
    )
      merged.push(transition);
  });
  return merged.length > 0 ? merged : undefined;
}

function edgeSwitchCases(
  jobNodeId: string,
  edges: WorkflowEdge[],
): WorkflowSwitchCase[] | undefined {
  const switchCases = edges.flatMap((edge) => {
    if (
      edge.source !== jobNodeId ||
      edge.data?.kind !== "switch" ||
      edge.data.isDefault
    )
      return [];
    return [
      {
        case: edge.data.caseCondition,
        inputs: { ...edge.data.inputs, next: edge.target },
      },
    ];
  });
  return switchCases.length > 0 ? switchCases : undefined;
}

function edgeSwitchDefault(
  jobNodeId: string,
  edges: WorkflowEdge[],
): WorkflowSwitchDefault | undefined {
  const defaultEdge = edges.find(
    (edge) =>
      edge.source === jobNodeId &&
      edge.data?.kind === "switch" &&
      edge.data.isDefault,
  );
  return defaultEdge?.data?.kind === "switch"
    ? { inputs: { ...defaultEdge.data.inputs, next: defaultEdge.target } }
    : undefined;
}

function groupStepNodes(stepNodes: StepNode[]): Map<string, StepNode[]> {
  return stepNodes.reduce((groups, stepNode) => {
    const parentId = stepNode.parentId ?? stepNode.data.parentJobId;
    groups.set(parentId, [...(groups.get(parentId) ?? []), stepNode]);
    return groups;
  }, new Map<string, StepNode[]>());
}

function isJobNode(node: JobNode | StepNode): node is JobNode {
  return node.type === "job";
}

function isStepNode(node: JobNode | StepNode): node is StepNode {
  return node.type === "step";
}

function optionalString(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

function optionalRecord(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

function uniqueValue<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}

function dependenciesEqual(left: WorkflowNeed, right: WorkflowNeed): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
