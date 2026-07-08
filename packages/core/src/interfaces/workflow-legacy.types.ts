import {
  WORKFLOW_RUN_EXECUTION_STATUS_VALUES,
  type WorkflowRunExecutionStatusV1,
} from "../schemas/workflow-run/workflow-run-contracts.schema";
import type { SkillDiscoveryMode } from "../skills/skill-discovery-mode.types";
import type { ToolPolicyDocument } from "../tool-policy/tool-policy.types";

export type WorkflowStatus = WorkflowRunExecutionStatusV1;
export const WorkflowStatus = Object.fromEntries(
  WORKFLOW_RUN_EXECUTION_STATUS_VALUES.map((status) => [status, status]),
) as { readonly [Status in WorkflowStatus]: Status };

export interface IWorkflow {
  id: string;
  name: string;
  yaml_definition: string;
  is_active: boolean;
  source_type?: string;
  scope_id?: string | null;
  source_path?: string | null;
  source_ref?: string | null;
  source_hash?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IWorkflowRun {
  id: string;
  workflow_id: string;
  status: WorkflowStatus;
  current_step_id?: string;
  state_variables: Record<string, unknown>;
  /** True while the run is blocked waiting for a human answer (ask_user_questions). */
  awaiting_input?: boolean;
  concurrency_scope?: string | null;
  display_name?: string;
  workflow_name?: string | null;
  source_type?: "seed" | "user" | "repository";
  started_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IToolApiCallback {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path_template?: string;
  body_mapping?: Record<string, string>;
  inject_scope_id?: boolean;
  external_mcp?: {
    url: string;
    headers?: Record<string, string>;
    remote_tool_name: string;
  };
}

export type ToolRegistrySource =
  | "decorator_provider"
  | "internal_tool_handler"
  | "external_mcp"
  | "external_acp"
  | "manual";

export interface IToolRegistry {
  id: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  source: ToolRegistrySource;
  runtime_owner?: "api" | "runner";
  transport?:
    | "api_callback"
    | "runner_local"
    | "mounted_tool"
    | "websocket_bridge";
  api_callback?: IToolApiCallback | boolean | null;
  language?: ToolCandidateLanguage;
  publication_status?: ToolCandidateStatus;
  published_artifact_id?: string | null;
  published_version?: number | null;
  created_at: Date;
  updated_at: Date;
}

export type ToolCandidateLanguage = "node" | "python";

export type ToolCandidateStatus =
  | "draft"
  | "validated"
  | "published"
  | "failed";

export type ToolValidationRunStatus =
  | "passed"
  | "failed"
  | "timeout"
  | "policy_denied";

export interface IToolArtifact {
  id: string;
  tool_name: string;
  language: ToolCandidateLanguage;
  source_code: string;
  test_spec?: string | null;
  schema: Record<string, unknown>;
  checksum: string;
  version: number;
  status: ToolCandidateStatus;
  latest_validation_run_id?: string | null;
  is_active: boolean;
  validated_at?: Date | null;
  published_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IToolValidationRun {
  id: string;
  artifact_id: string;
  sandbox_image: string;
  status: ToolValidationRunStatus;
  exit_code?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  duration_ms?: number | null;
  policy_denials?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface IPiSessionTree {
  id: string;
  workflow_run_id?: string | null;
  chat_session_id?: string | null;
  container_tier: number;
  jsonl_data: unknown[];
  last_leaf_node_id?: string;
  archived_at?: Date | null;
  archive_reason?: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Memory segment row. The `memory_type` union enumerates the segment kinds
 * the memory system knows how to persist. `strategic_intent` was added in
 * EPIC-208 (Milestone 1) so the CEO cycle can carry long-term planning
 * intent (horizon, priority_themes, focus_areas, constraints) across
 * orchestration cycles; the structured payload is validated by
 * `strategicIntentBodySchema` in `workflow-runtime-inputs.schemas.ts` and
 * persisted in `metadata_json`.
 */
export interface IMemorySegment {
  id: string;
  entity_type: string;
  entity_id: string;
  memory_type: "preference" | "fact" | "history" | "strategic_intent";
  content: string;
  version: number;
  metadata_json?: Record<string, unknown> | null;
  /**
   * Wall-clock timestamp of the most recent read. Used by the
   * nightly MemoryEvictionReaper to decide whether a segment is
   * "stale enough" to evict. Nullable: a null value is treated as
   * "never touched" by the reaper.
   */
  last_accessed_at?: Date | null;
  /**
   * Monotonically-increasing counter of successful reads. Used by
   * the nightly MemoryEvictionReaper to preserve "load-bearing"
   * segments that have been read at least once. Defaults to 0.
   */
  access_count?: number;
  /**
   * Operator-driven pin flag. Pinned rows are NEVER auto-evicted.
   * Defaults to false. The reaper treats `pinned = true` as an
   * absolute short-circuit.
   */
  pinned?: boolean;
  /**
   * Coarse classification of where this segment came from. Used by
   * the nightly MemoryEvictionReaper to skip rows whose source is
   * in the protected allowlist. Nullable so older rows remain
   * valid; the reaper treats null source as evictable.
   */
  source?: string | null;
  /**
   * Wall-clock timestamp of the most recent explicit reinforcement
   * (e.g. a `getMemorySegments` / `searchMemory` read). Used by the
   * follow-up nightly `MemoryDecayReaper` together with
   * `last_accessed_at` to decide whether a segment is "fresh
   * enough" to skip confidence decay (work item
   * 3d7fb798-f54d-40ff-a803-438224474912). The reaper treats
   * `null` as "never reinforced" and falls through to the
   * eviction-style `last_accessed_at` (or `created_at`) instead.
   */
  last_reinforced_at?: Date | null;
  /**
   * Wall-clock timestamp at which the `MemoryDecayReaper` archived
   * the segment because its decayed confidence fell below the
   * configured floor. Used by callers to distinguish "active" from
   * "archived" rows. The reaper NEVER deletes archived rows — they
   * are preserved for auditability.
   */
  archived_at?: Date | null;
  /**
   * Wall-clock timestamp at which the `MemoryDriftDetectionService`
   * flagged the segment as drifted against its underlying reality
   * (file path, schema column, or API endpoint referenced by the
   * segment's `source_metadata`). Used by callers to filter out
   * segments that have already been detected as drifted so the
   * drift detector is idempotent. Nullable: a `null` value is
   * treated as "never detected as drifted" — the detector's hot
   * candidate filter is `WHERE drift_detected_at IS NULL`.
   *
   * @see work item 0cead042-e823-4e26-9386-02042252ffb0
   */
  drift_detected_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IWorkflowTransition {
  condition: string;
  next: string;
}

export type JobStepType = "agent" | "run_command" | "set_variable" | "wait";

export interface IRunCommandOutput {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export interface ISetVariableOutput {
  ok: true;
  variables: Record<string, unknown>;
}

export interface IWaitOutput {
  ok: true;
  waited_ms: number;
}

export type WorkflowDependencyResult =
  | "success"
  | "skipped"
  | "failed"
  | "cancelled"
  | "success_or_skipped"
  | "any";

export interface WorkflowNeedObject {
  /** Job id for workflow-level dependencies. */
  job?: string;
  /** Step id for job-internal step dependencies. */
  step?: string;
  /** Required upstream result. Defaults to success. */
  result?: WorkflowDependencyResult;
  /** Optional needs do not block when the target is absent in a dynamic branch. */
  optional?: boolean;
}

export type WorkflowNeed = string | WorkflowNeedObject;

export interface IJobStep {
  id: string;
  type?: JobStepType;
  prompt?: string;
  prompt_file?: string;
  prompt_mode?: "override" | "append";
  /** Override how assigned skills are surfaced for this step. */
  skill_discovery_mode?: SkillDiscoveryMode;
  command?: string;
  working_dir?: string;
  variables?: Record<string, unknown>;
  timeout_ms?: number;
  /** GitHub Actions-style dependencies between steps in the same job. */
  needs?: WorkflowNeed[];
  /** Optional Handlebars condition evaluated with steps + needs context. */
  if?: string;
  transitions?: IWorkflowTransition[];
  on_error?: "fail" | "continue" | `goto:${string}`;
  max_loops?: number;
}

export type HostMountMode = "ro" | "rw";

export interface IHostMountRequest {
  alias: string;
  subpath?: string;
  mode?: HostMountMode;
}

export interface IHostMountBinding {
  alias: string;
  hostPath: string;
  containerPath: string;
  mode: HostMountMode;
  readOnly: boolean;
}

export type CoreWorkflowSpecialJobType =
  | "register_tool" // deprecated: use manage_tool_candidate or MCP-backed tools
  | "invoke_workflow"
  | "run_command"
  | "web_automation"
  | "emit_event"
  | "http_webhook"
  | "mcp_tool_call"
  | "git_operation"
  | "manage_tool_candidate";

export type WorkflowSpecialJobType = CoreWorkflowSpecialJobType | (string & {});

export type WorkflowJobType = "execution" | WorkflowSpecialJobType;

export type OutputContractScalarType =
  | "string"
  | "number"
  | "integer"
  | "boolean";

export type OutputContractContainerType = "array" | "object";

export type OutputContractType =
  | OutputContractScalarType
  | OutputContractContainerType;

export interface OutputContractArraySchema {
  type: "array";
  items?: OutputContractTypeSchema;
}

export interface OutputContractObjectSchema {
  type: "object";
  properties?: Record<string, OutputContractTypeSchema>;
}

export type OutputContractTypeSchema =
  | OutputContractType
  | OutputContractArraySchema
  | OutputContractObjectSchema;

/**
 * Reconciles a reported numeric output field against the number of times a tool
 * actually succeeded during the job. Guards against an agent fabricating a count
 * (e.g. reporting `items_created: 53` while never calling the create tool). The
 * reported value must equal the count of successful executions of `tool`.
 */
export interface OutputContractReconciliation {
  /** Output field whose reported value must match the successful tool-call count. */
  field: string;
  /** Tool whose successful executions are counted for this job. */
  tool: string;
}

export interface OutputContract {
  required: string[];
  optional?: string[];
  types?: Record<string, OutputContractTypeSchema>;
  reconcile?: OutputContractReconciliation[];
}

export interface WorkflowSwitchCase {
  case: string;
  inputs?: Record<string, unknown>;
}

export interface WorkflowSwitchDefault {
  inputs?: Record<string, unknown>;
}

interface IBaseJob {
  id: string;
  type: WorkflowJobType;
  tier: string;
  condition?: string;
  /** Legacy dependency key. Prefer `needs` for new workflows. */
  depends_on?: string[];
  /** GitHub Actions-style dependencies with result-aware policies. */
  needs?: WorkflowNeed[];
  /** Optional alias for condition; `condition` remains supported. */
  if?: string;
  /** Opt into result-aware dependency semantics for this job. */
  strict_dependencies?: boolean;
  inputs?: Record<string, unknown>;
  workflow_id?: string;
  wait_for_completion?: boolean;
  continue_on_concurrency_skip?: boolean;
  permissions?: IToolPermissionPolicy;
  host_mounts?: IHostMountRequest[];
  tools?: string[];
  transitions?: IWorkflowTransition[];
  max_retries?: number;
  retry_prompt?: string;
  max_step_loops?: number;
  output_contract?: OutputContract;
  switch?: WorkflowSwitchCase[];
  default?: WorkflowSwitchDefault;
  for_each?: string;
  continue_on_error?: boolean;
}

export interface IExecutionJob extends IBaseJob {
  type: "execution";
  steps: IJobStep[];
}

export interface ISpecialJob extends IBaseJob {
  type: WorkflowSpecialJobType;
  steps?: IJobStep[];
}

export type IJob = IExecutionJob | ISpecialJob;

export type ToolPolicyStrategy = "layered" | "profile_only";

export interface IToolPermissionPolicy {
  policy_strategy?: ToolPolicyStrategy;
  tool_policy?: ToolPolicyDocument;
  allow_host_mounts?: string[];
  deny_host_mounts?: string[];
  allow_host_mount_rw?: string[];
}

export interface IWorkflowStep {
  id: string;
  type: string;
  tier: string;
  depends_on?: string[];
  inputs?: Record<string, unknown>;
  workflow_id?: string;
  wait_for_completion?: boolean;
  continue_on_concurrency_skip?: boolean;
  permissions?: IToolPermissionPolicy;
  host_mounts?: IHostMountRequest[];
  tools?: string[];
  transitions?: IWorkflowTransition[];
  max_retries?: number;
  retry_prompt?: string;
  output_contract?: OutputContract;
  switch?: WorkflowSwitchCase[];
  default?: WorkflowSwitchDefault;
  for_each?: string;
  continue_on_error?: boolean;
}

export type ConcurrencyConflictPolicy = "skip" | "queue" | "cancel_running";

export interface IConcurrencyPolicy {
  max_runs: number;
  scope?: string;
  on_conflict?: ConcurrencyConflictPolicy;
}

export type WorkflowLaunchContextRequirement = "none" | "required";

export type WorkflowLaunchInputType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "string_array";

export interface IWorkflowLaunchInput {
  key: string;
  label?: string;
  description?: string;
  type?: WorkflowLaunchInputType;
  required?: boolean;
  default?: unknown;
}

export interface IWorkflowLaunchMetadata {
  context?: WorkflowLaunchContextRequirement;
  inputs?: IWorkflowLaunchInput[];
  allow_raw_json?: boolean;
}

export interface IWorkflowDefinition {
  workflow_id: string;
  name: string;
  description?: string;
  trigger?: IWorkflowTrigger;
  global_env?: Record<string, string>;
  permissions?: IToolPermissionPolicy;
  concurrency?: IConcurrencyPolicy;
  /** Opt into result-aware dependency semantics for all jobs in this workflow. */
  strict_dependencies?: boolean;
  /** Default skill discovery mode for all steps in this workflow. */
  skill_discovery_mode?: SkillDiscoveryMode;
  /**
   * Workflow-level YAML-declared skill names, unioned into every step/subagent's
   * effective skill set alongside profile assignments, runtime bindings, and any
   * step-level `inputs.skills` override. See `resolveEffectiveSkills`.
   */
  skills?: string[];
  jobs?: IJob[];
  steps?: IWorkflowStep[];
}

export interface IWorkflowTrigger {
  type: "event" | "webhook" | "manual" | "lifecycle";
  name?: string;
  event?: string;
  description?: string;
  launch?: IWorkflowLaunchMetadata;
  /**
   * Optional Handlebars expression evaluated against the trigger payload.
   * When present, the workflow is only started if the rendered value equals
   * the literal string "true". Missing or whitespace-only values are treated
   * as an unconditional trigger.
   */
  condition?: string;
  /** Lifecycle phase identifier (required for lifecycle triggers). */
  phase?: string;
  /** Lifecycle hook position (required for lifecycle triggers). */
  hook?: string;
  /** Whether the lifecycle trigger blocks the operation. */
  blocking?: boolean;
}

export enum ContainerTier {
  LIGHT = "LIGHT",
  HEAVY = "HEAVY",
}

export enum ContainerState {
  CREATED = "CREATED",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  STOPPED = "STOPPED",
  DEAD = "DEAD",
  EXITED = "EXITED",
  RESTARTING = "RESTARTING",
  UNKNOWN = "UNKNOWN",
}

export interface IContainerConfig {
  image: string;
  tier: ContainerTier;
  env?: Record<string, string>;
  volumes?: Array<{
    hostPath: string;
    containerPath: string;
    readOnly?: boolean;
  }>;
  labels?: Record<string, string>;
  workingDir?: string;
}

export interface IContainerStatus {
  id: string;
  name: string;
  state: ContainerState;
  status: string;
  created: Date;
  image: string;
}

export interface IContainerStats {
  cpuUsage: number;
  memoryUsage: number;
  memoryLimit: number;
  timestamp: Date;
}

export type WorkflowNodeRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "blocked"
  | "waiting_input"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type WorkflowGraphNodeKind = "job" | "step";

export type WorkflowGraphEdgeKind =
  | "depends_on"
  | "transition"
  | "contains"
  | "sequence";

export interface WorkflowGraphNode {
  id: string;
  label: string;
  kind: WorkflowGraphNodeKind;
  status: WorkflowNodeRuntimeStatus;
  jobId?: string;
  stepId?: string;
  parentJobId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkflowGraphEdgeKind;
}

export interface WorkflowGraphCursor {
  latestEventAt: string | null;
  totalEvents: number;
}

export interface WorkflowRunGraphSnapshot {
  workflowId: string;
  workflowRunId: string | null;
  runStatus: WorkflowStatus | null;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  activeNodeIds: string[];
  queuedNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  cursor: WorkflowGraphCursor;
}
