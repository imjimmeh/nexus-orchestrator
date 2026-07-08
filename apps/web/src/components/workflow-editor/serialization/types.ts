import type { Edge, Node } from "@xyflow/react";
import type {
  IHostMountRequest,
  IWorkflowTransition,
  OutputContract,
  WorkflowNeed,
  WorkflowSwitchCase,
  WorkflowSwitchDefault,
} from "@nexus/core";
import type {
  ConcurrencyConfig,
  PermissionsConfig,
  TriggerConfig,
} from "../hooks/useWorkflowEditorStore.types";

export type JobType =
  | "execution"
  | "invoke_workflow"
  | "run_command"
  | "emit_event"
  | "http_webhook"
  | "web_automation"
  | "mcp_tool_call"
  | "git_operation"
  | "register_tool"
  | "manage_tool_candidate";

export type StepType = "agent" | "run_command" | "set_variable" | "wait";

export type EdgeKind = "dependency" | "transition" | "switch";

export type ResultPolicy =
  | "success"
  | "skipped"
  | "failed"
  | "cancelled"
  | "success_or_skipped"
  | "any";

export interface DependencyEdgeData extends Record<string, unknown> {
  kind: "dependency";
  resultPolicy?: ResultPolicy;
  optional?: boolean;
}

export interface TransitionEdgeData extends Record<string, unknown> {
  kind: "transition";
  condition: string;
  target: string;
}

export interface SwitchEdgeData extends Record<string, unknown> {
  kind: "switch";
  caseCondition: string;
  inputs?: Record<string, unknown>;
  isDefault?: boolean;
}

export type WorkflowEdgeData =
  | DependencyEdgeData
  | TransitionEdgeData
  | SwitchEdgeData;

export interface JobNodeData extends Record<string, unknown> {
  label: string;
  jobType: JobType;
  tier?: string;
  jobId: string;
  condition?: string;
  inputs?: Record<string, unknown>;
  permissions?: PermissionsConfig;
  hostMounts?: IHostMountRequest[];
  transitions?: IWorkflowTransition[];
  switchCases?: WorkflowSwitchCase[];
  switchDefault?: WorkflowSwitchDefault;
  maxRetries?: number;
  retryPrompt?: string;
  outputContract?: OutputContract;
  maxStepLoops?: number;
  agentProfile?: string;
  targetWorkflowId?: string;
  waitForCompletion?: boolean;
  command?: string;
  workingDir?: string;
  timeoutMs?: number;
  eventName?: string;
  payload?: unknown;
  url?: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  allowedUrls?: string[];
  action?: string;
  serverId?: string;
  toolName?: string;
  params?: Record<string, unknown>;
  allowedServers?: string[];
  allowedTools?: string[];
  repositoryId?: string;
  toolSchema?: Record<string, unknown>;
  typescriptCode?: string;
  tierRestriction?: string;
  artifactId?: string;
  dependsOn?: string[];
  needs?: WorkflowNeed[];
  strictDependencies?: boolean;
  continueOnError?: boolean;
  continueOnConcurrencySkip?: boolean;
  forEach?: string;
}

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  stepType: StepType;
  stepId: string;
  parentJobId: string;
  prompt?: string;
  promptFile?: string;
  promptMode?: "override" | "append";
  harnessId?: string;
  command?: string;
  workingDir?: string;
  variables?: Record<string, unknown>;
  timeoutMs?: number;
  needs?: WorkflowNeed[];
  if?: string;
  maxLoops?: number;
  transitions?: IWorkflowTransition[];
  onError?: "fail" | "continue" | `goto:${string}`;
}

export interface ParsedWorkflowMetadata {
  workflowId: string;
  name: string;
  description: string;
  trigger: TriggerConfig | null;
  concurrency: ConcurrencyConfig | null;
  permissions: PermissionsConfig | null;
  globalEnv: Record<string, string>;
  strictDependencies: boolean;
  active: boolean;
}

export interface ParsedWorkflow {
  metadata: ParsedWorkflowMetadata;
  nodes: Array<JobNode | StepNode>;
  edges: WorkflowEdge[];
}

export type JobNode = Node<JobNodeData, "job">;
export type StepNode = Node<StepNodeData, "step">;
export type WorkflowEdge = Edge<WorkflowEdgeData>;
