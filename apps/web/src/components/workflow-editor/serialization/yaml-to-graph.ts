import { load } from "js-yaml";
import type {
  IWorkflowTransition,
  OutputContract,
  WorkflowNeed,
  WorkflowSwitchCase,
} from "@nexus/core";
import { buildJobLayout } from "../../workflow/workflow-graph-layout";
import type {
  WorkflowGraphEdge,
  WorkflowGraphNode,
} from "@/lib/api/workflows.types";
import { dropUndefined } from "./utils";
import {DependencyEdgeData, JobNode, JobType, ParsedWorkflow, StepNode, StepType, WorkflowEdge} from "./types";

function parseYaml(yamlString: string): unknown {
  try {
    return load(yamlString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed workflow YAML: ${message}`, { cause: error });
  }
}

const STEP_SPACING_Y = 120;
const SPECIAL_TRANSITION_TARGETS = new Set(["done", "fail_job"]);

export function parseYamlToGraph(yamlString: string): ParsedWorkflow {
  const workflow = toRecord(parseYaml(yamlString));
  const jobs = readJobs(workflow.jobs);
  const jobIds = new Set(jobs.map(([jobId]) => jobId));
  const edges = jobs.flatMap(([jobId, job]) => [
    ...readDependencyEdges(jobId, job),
    ...readTransitionEdges(jobId, job, jobIds),
    ...readSwitchEdges(jobId, job, jobIds),
  ]);
  const positions = buildParsedJobLayout(jobs, edges);
  const nodes: Array<JobNode | StepNode> = [];

  jobs.forEach(([jobId, job], jobIndex) => {
    const jobPosition = positions.get(jobId) ?? {
      x: 0,
      y: jobIndex * STEP_SPACING_Y,
    };
    const jobNode = makeJobNode(jobId, job, jobPosition);
    nodes.push(jobNode);

    readSteps(job.steps).forEach(([stepId, step], stepIndex) => {
      nodes.push(makeStepNode(jobId, stepId, step, jobPosition, stepIndex));
    });
  });

  return {
    metadata: {
      workflowId: readString(workflow.workflow_id) ?? "",
      name: readString(workflow.name) ?? "",
      description: readString(workflow.description) ?? "",
      trigger: readMetadataRecord(
        workflow.trigger,
      ) as ParsedWorkflow["metadata"]["trigger"],
      concurrency: readMetadataRecord(
        workflow.concurrency,
      ) as ParsedWorkflow["metadata"]["concurrency"],
      permissions: readMetadataRecord(
        workflow.permissions,
      ) as ParsedWorkflow["metadata"]["permissions"],
      globalEnv: readStringRecord(workflow.global_env),
      strictDependencies: readBoolean(workflow.strict_dependencies) ?? false,
      active: readBoolean(workflow.active) ?? true,
    },
    nodes,
    edges,
  };
}

function coalesce<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a ?? b;
}

function readJobFallbackA(
  job: Record<string, unknown>,
  inputs: Record<string, unknown> | undefined,
) {
  return {
    condition: coalesce(readString(job.condition), readString(job.if)),
    targetWorkflowId: coalesce(
      readString(job.workflow_id),
      readString(inputs?.workflow_id),
    ),
    waitForCompletion: coalesce(
      readBoolean(job.wait_for_completion),
      readBoolean(inputs?.wait_for_completion),
    ),
    command: coalesce(readString(job.command), readString(inputs?.command)),
    workingDir: coalesce(
      readString(job.working_dir),
      readString(inputs?.working_dir),
    ),
    timeoutMs: coalesce(
      readNumber(job.timeout_ms),
      readNumber(inputs?.timeout_ms),
    ),
    eventName: coalesce(
      readString(job.event_name),
      readString(inputs?.event_name),
    ),
    payload: coalesce(job.payload, inputs?.payload),
  };
}

function readJobFallbackB(
  job: Record<string, unknown>,
  inputs: Record<string, unknown> | undefined,
) {
  return {
    url: coalesce(readString(job.url), readString(inputs?.url)),
    method: coalesce(readString(job.method), readString(inputs?.method)),
    headers: coalesce(
      readNullableRecord(job.headers),
      readNullableRecord(inputs?.headers),
    ),
    body: coalesce(job.body, inputs?.body),
    allowedUrls: coalesce(
      readStringArray(job.allowed_urls),
      readStringArray(inputs?.allowed_urls),
    ),
    action: coalesce(readString(job.action), readString(inputs?.action)),
    serverId: coalesce(
      readString(job.server_id),
      readString(inputs?.server_id),
    ),
    toolName: coalesce(
      readString(job.tool_name),
      readString(inputs?.tool_name),
    ),
  };
}

function readJobFallbackC(
  job: Record<string, unknown>,
  inputs: Record<string, unknown> | undefined,
) {
  return {
    params: coalesce(
      readNullableRecord(job.params),
      readNullableRecord(inputs?.params),
    ),
    allowedServers: coalesce(
      readStringArray(job.allowed_servers),
      readStringArray(inputs?.allowed_servers),
    ),
    allowedTools: coalesce(
      readStringArray(job.allowed_tools),
      readStringArray(inputs?.allowed_tools),
    ),
    repositoryId: coalesce(
      readString(job.repository_id),
      readString(inputs?.repository_id),
    ),
    toolSchema: coalesce(
      readNullableRecord(job.tool_schema),
      readNullableRecord(inputs?.tool_schema),
    ),
    typescriptCode: coalesce(
      readString(job.typescript_code),
      readString(inputs?.typescript_code),
    ),
    tierRestriction: coalesce(
      readString(job.tier_restriction),
      readString(inputs?.tier_restriction),
    ),
    artifactId: coalesce(
      readString(job.artifact_id),
      readString(inputs?.artifact_id),
    ),
  };
}

function makeJobNode(
  jobId: string,
  job: Record<string, unknown>,
  position: { x: number; y: number },
): JobNode {
  const inputs = readNullableRecord(job.inputs);
  const fa = readJobFallbackA(job, inputs);
  const fb = readJobFallbackB(job, inputs);
  const fc = readJobFallbackC(job, inputs);
  return {
    id: jobId,
    type: "job",
    position,
    data: {
      label: jobId,
      jobId,
      jobType: readJobType(job.type),
      tier: readString(job.tier),
      inputs,
      permissions: readNullableRecord(job.permissions),
      hostMounts: readArray(job.host_mounts),
      transitions: readArray(job.transitions),
      switchCases: readArray(job.switch),
      switchDefault: readNullableRecord(job.default),
      maxRetries: readNumber(job.max_retries),
      retryPrompt: readString(job.retry_prompt),
      outputContract: isRecord(job.output_contract)
        ? (job.output_contract as unknown as OutputContract)
        : undefined,
      maxStepLoops: readNumber(job.max_step_loops),
      agentProfile: readString(inputs?.agent_profile),
      dependsOn: readStringArray(job.depends_on),
      needs: readArray(job.needs),
      strictDependencies: readBoolean(job.strict_dependencies),
      continueOnError: readBoolean(job.continue_on_error),
      continueOnConcurrencySkip: readBoolean(job.continue_on_concurrency_skip),
      forEach: readString(job.for_each),
      ...fa,
      ...fb,
      ...fc,
    },
  };
}

function makeStepNode(
  jobId: string,
  stepId: string,
  step: Record<string, unknown>,
  jobPosition: { x: number; y: number },
  stepIndex: number,
): StepNode {
  return {
    id: `${jobId}.${stepId}`,
    type: "step",
    parentId: jobId,
    position: {
      x: jobPosition.x,
      y: jobPosition.y + (stepIndex + 1) * STEP_SPACING_Y,
    },
    data: {
      label: stepId,
      stepId,
      parentJobId: jobId,
      stepType: readStepType(step.type),
      prompt: readString(step.prompt),
      promptFile: readString(step.prompt_file),
      promptMode: readPromptMode(step.prompt_mode),
      harnessId: readString(step.harness_id),
      command: readString(step.command),
      workingDir: readString(step.working_dir),
      variables: readNullableRecord(step.variables),
      timeoutMs: readNumber(step.timeout_ms),
      needs: readArray(step.needs),
      if: readString(step.if),
      maxLoops: readNumber(step.max_loops),
      transitions: readArray(step.transitions),
      onError: readOnError(step.on_error),
    },
  };
}

function buildParsedJobLayout(
  jobs: Array<[string, Record<string, unknown>]>,
  edges: WorkflowEdge[],
): Map<string, { x: number; y: number }> {
  const layoutNodes: WorkflowGraphNode[] = jobs.map(([jobId]) => ({
    id: jobId,
    label: jobId,
    kind: "job",
    status: "idle",
  }));
  const layoutEdges: WorkflowGraphEdge[] = edges.flatMap((edge) => {
    if (edge.data?.kind === "dependency") {
      const layoutEdge: WorkflowGraphEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: "depends_on",
      };
      return [layoutEdge];
    }
    if (edge.data?.kind === "transition") {
      const layoutEdge: WorkflowGraphEdge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: "transition",
      };
      return [layoutEdge];
    }
    return [];
  });
  return buildJobLayout(layoutNodes, layoutEdges);
}

function readJobs(value: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const job = readNullableRecord(item);
      const id = readString(job?.id);
      return job && id ? [[id, job]] : [];
    });
  }
  const jobs = readNullableRecord(value);
  if (!jobs) return [];
  return Object.entries(jobs).flatMap(([id, jobValue]) => {
    const job = readNullableRecord(jobValue);
    return job ? [[id, { id, ...job }]] : [];
  });
}

function readSteps(value: unknown): Array<[string, Record<string, unknown>]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const step = readNullableRecord(item);
    const id = readString(step?.id) ?? `step-${index + 1}`;
    return step ? [[id, step]] : [];
  });
}

function readDependencyEdges(
  jobId: string,
  job: Record<string, unknown>,
): WorkflowEdge[] {
  const dependsOnEdges = (readStringArray(job.depends_on) ?? []).map((source) =>
    dependencyEdge(source, jobId, {}),
  );
  const needsEdges = readArray<WorkflowNeed>(job.needs).flatMap((need) => {
    if (typeof need === "string") return [dependencyEdge(need, jobId, {})];
    if (!isRecord(need) || typeof need.job !== "string") return [];
    return [
      dependencyEdge(need.job, jobId, {
        resultPolicy: readResultPolicy(need.result),
        optional: readBoolean(need.optional),
      }),
    ];
  });
  return [...dependsOnEdges, ...needsEdges];
}

function dependencyEdge(
  source: string,
  target: string,
  data: Omit<DependencyEdgeData, "kind">,
): WorkflowEdge {
  return {
    id: `${source}->${target}:dependency`,
    source,
    target,
    data: { kind: "dependency", ...dropUndefined(data) },
  };
}

function readTransitionEdges(
  jobId: string,
  job: Record<string, unknown>,
  jobIds: Set<string>,
): WorkflowEdge[] {
  return readArray<IWorkflowTransition>(job.transitions).flatMap(
    (transition) => {
      if (!isRecord(transition)) return [];
      const condition = readString(transition.condition);
      const target = readString(transition.next);
      if (
        !condition ||
        !target ||
        SPECIAL_TRANSITION_TARGETS.has(target) ||
        !jobIds.has(target)
      )
        return [];
      return [
        {
          id: `${jobId}->${target}:transition:${condition}`,
          source: jobId,
          target,
          data: { kind: "transition", condition, target },
        },
      ];
    },
  );
}

function readSwitchEdges(
  jobId: string,
  job: Record<string, unknown>,
  jobIds: Set<string>,
): WorkflowEdge[] {
  const caseEdges = readArray<WorkflowSwitchCase>(job.switch).flatMap(
    (switchCase, index) => {
      if (!isRecord(switchCase)) return [];
      const condition = readString(switchCase.case);
      const target = readString(readNullableRecord(switchCase.inputs)?.next);
      if (!condition || !target || !jobIds.has(target)) return [];
      const edge: WorkflowEdge = {
        id: `${jobId}->${target}:switch:${index}`,
        source: jobId,
        target,
        data: {
          kind: "switch",
          caseCondition: condition,
          inputs: readNullableRecord(switchCase.inputs),
        },
      };
      return [edge];
    },
  );
  const defaultInputs = readNullableRecord(
    readNullableRecord(job.default)?.inputs,
  );
  const defaultTarget = readString(defaultInputs?.next);
  if (!defaultTarget || !jobIds.has(defaultTarget)) return caseEdges;
  const defaultEdge: WorkflowEdge = {
    id: `${jobId}->${defaultTarget}:switch:default`,
    source: jobId,
    target: defaultTarget,
    data: {
      kind: "switch",
      caseCondition: "default",
      inputs: defaultInputs,
      isDefault: true,
    },
  };
  return [...caseEdges, defaultEdge];
}

function readJobType(value: unknown): JobType {
  const type = readString(value);
  if (
    type === "invoke_workflow" ||
    type === "run_command" ||
    type === "emit_event" ||
    type === "http_webhook" ||
    type === "web_automation" ||
    type === "mcp_tool_call" ||
    type === "git_operation" ||
    type === "register_tool" ||
    type === "manage_tool_candidate"
  )
    return type;
  return "execution";
}

function readStepType(value: unknown): StepType {
  const type = readString(value);
  if (type === "run_command" || type === "set_variable" || type === "wait")
    return type;
  return "agent";
}

function readResultPolicy(value: unknown): DependencyEdgeData["resultPolicy"] {
  const result = readString(value);
  if (
    result === "success" ||
    result === "skipped" ||
    result === "failed" ||
    result === "cancelled" ||
    result === "success_or_skipped" ||
    result === "any"
  )
    return result;
  return undefined;
}

function readPromptMode(value: unknown): StepNode["data"]["promptMode"] {
  return value === "override" || value === "append" ? value : undefined;
}

function readOnError(value: unknown): StepNode["data"]["onError"] {
  if (value === "fail" || value === "continue") return value;
  if (typeof value === "string" && value.startsWith("goto:"))
    return value as `goto:${string}`;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = readNullableRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readNullableRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function readMetadataRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return readNullableRecord(value) ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
