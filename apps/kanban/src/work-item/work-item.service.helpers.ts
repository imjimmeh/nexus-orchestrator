import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type {
  WorkflowLifecycleExecutionRequest,
  WorkflowRunRequestV1,
} from "@nexus/core";
import {
  resolveRepositoryWorkflowSettings,
  StoryPointsSchema,
  WorkItemTypeSchema,
} from "@nexus/kanban-contracts";
import type { StoryPoints, WorkItemType } from "@nexus/kanban-contracts";
import { resolveKanbanExternalMcpMounts } from "../mcp/kanban-mcp-run-mounts";
import type { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type {
  LifecycleGateFailure,
  WorkItemRecord,
  WorkItemStatus,
} from "./work-item.types";
import type { TransitionGateResult } from "./work-item.service.helpers.types";
import type {
  CoreWorkflowRequester,
  HumanFeedbackResolutionInput,
  NormalizedSubtaskInput,
  WorkItemPatch,
  WorkItemEntityRecord,
  WorkItemSubtaskRecord,
} from "./work-item.service.types";

export const SUPPORTED_WORK_ITEM_STATUSES: ReadonlySet<WorkItemStatus> =
  new Set([
    "backlog",
    "todo",
    "refinement",
    "in-progress",
    "in-review",
    "ready-to-merge",
    "awaiting-pr-merge",
    "blocked",
    "done",
  ]);

export function isSupportedWorkItemStatus(
  status: string,
): status is WorkItemStatus {
  return SUPPORTED_WORK_ITEM_STATUSES.has(status as WorkItemStatus);
}

export function isRecord(data: unknown): data is Record<string, unknown> {
  return Boolean(data) && typeof data === "object" && !Array.isArray(data);
}

export function normalizeSubtaskInput(
  input: unknown[],
): NormalizedSubtaskInput[] {
  return input.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.subtaskId !== "string" ||
      typeof entry.title !== "string"
    ) {
      return [];
    }

    return [
      {
        subtaskId: entry.subtaskId,
        title: entry.title,
        ...(typeof entry.status === "string" ? { status: entry.status } : {}),
        ...(typeof entry.orderIndex === "number"
          ? { orderIndex: entry.orderIndex }
          : {}),
        ...(Array.isArray(entry.dependsOnSubtaskIds)
          ? {
              dependsOnSubtaskIds: entry.dependsOnSubtaskIds.filter(
                (id): id is string => typeof id === "string",
              ),
            }
          : {}),
        ...(typeof entry.sourcePath === "string"
          ? { sourcePath: entry.sourcePath }
          : {}),
        ...(isRecord(entry.metadata) || entry.metadata === null
          ? { metadata: entry.metadata }
          : {}),
      },
    ];
  });
}

export function toWorkItemRecord(
  item: WorkItemEntityRecord,
  dependencyIds: string[],
  subtasks: WorkItemSubtaskRecord[] = [],
  derived?: { hasChildren: boolean; rolledUpPoints: number | null },
): WorkItemRecord {
  return {
    id: item.id,
    project_id: item.project_id,
    title: item.title,
    description: item.description,
    status: item.status as WorkItemStatus,
    priority: item.priority,
    type: item.type as WorkItemType,
    parentWorkItemId: item.parent_work_item_id ?? null,
    storyPoints: (item.story_points ?? null) as StoryPoints | null,
    ...(derived
      ? {
          hasChildren: derived.hasChildren,
          rolledUpPoints: derived.rolledUpPoints,
        }
      : {}),
    assignedAgentId: item.assigned_agent_id,
    tokenSpend: item.token_spend,
    costCents: item.cost_cents,
    currentExecutionId: item.current_execution_id,
    waitingForInput: item.waiting_for_input,
    lastExecutionStatus: item.last_execution_status,
    executionConfig: item.execution_config ?? undefined,
    metadata: item.metadata,
    dependsOn: dependencyIds,
    blockedBy: dependencyIds,
    subtasks: subtasks.map((subtask) => ({
      id: subtask.id,
      subtaskId: subtask.subtask_id,
      workItemId: subtask.work_item_id,
      title: subtask.title,
      status: subtask.status as "todo" | "in_progress" | "done" | "blocked",
      orderIndex: subtask.order_index,
      dependsOnSubtaskIds: subtask.depends_on_subtask_ids ?? [],
      sourcePath: subtask.source_path,
      updatedAt: subtask.updated_at.toISOString(),
      metadata: subtask.metadata,
    })),
    linkedRunId: item.linked_run_id,
    createdAt: item.created_at.toISOString(),
    updatedAt: item.updated_at.toISOString(),
  };
}

export function asRecord(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) {
    return {};
  }
  return data;
}

/**
 * Resolves the type/parent/story-points slice of a work-item patch. Split
 * out of {@link asWorkItemPatch} purely to keep that function's cyclomatic
 * complexity under the repo lint ceiling.
 */
function resolveWorkItemTypePatchFields(
  value: Record<string, unknown>,
): Pick<WorkItemPatch, "type" | "parentWorkItemId" | "storyPoints"> {
  return {
    ...(WorkItemTypeSchema.safeParse(value.type).success
      ? { type: value.type as WorkItemType }
      : {}),
    ...(typeof value.parentWorkItemId === "string" ||
    value.parentWorkItemId === null
      ? { parentWorkItemId: value.parentWorkItemId }
      : {}),
    ...(value.storyPoints === null ||
    StoryPointsSchema.safeParse(value.storyPoints).success
      ? { storyPoints: value.storyPoints as number | null }
      : {}),
  };
}

export function asWorkItemPatch(data: unknown): WorkItemPatch {
  const value = asRecord(data);
  const dependencyIds = Array.isArray(value.dependencyIds)
    ? value.dependencyIds
    : value.dependsOn;
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string" || value.description === null
      ? { description: value.description }
      : {}),
    ...(typeof value.priority === "string" ? { priority: value.priority } : {}),
    ...resolveWorkItemTypePatchFields(value),
    ...(Array.isArray(dependencyIds)
      ? {
          dependencyIds: dependencyIds.filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
    ...(isRecord(value.executionConfig) || value.executionConfig === null
      ? { executionConfig: value.executionConfig }
      : {}),
    ...(isRecord(value.metadata) || value.metadata === null
      ? { metadata: value.metadata }
      : {}),
    ...(Array.isArray(value.subtasks)
      ? { subtasks: normalizeSubtaskInput(value.subtasks) }
      : {}),
  };
}

export function hasLifecycleStatusInMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return isRecord(metadata) && "status" in metadata;
}

export function getInputDependencyIds(input: {
  dependencyIds?: string[];
  dependsOn?: string[];
}): string[] {
  return [
    ...new Set([...(input.dependencyIds ?? []), ...(input.dependsOn ?? [])]),
  ];
}

export function resolveHumanFeedbackResolution(params: {
  metadata: Record<string, unknown> | null;
  input: HumanFeedbackResolutionInput;
  resolvedAt: string;
}): {
  metadata: Record<string, unknown>;
  previousDecisionPrompt: string | null;
  resolvedBy: string | null;
  response: string;
} {
  const currentMetadata = isRecord(params.metadata) ? params.metadata : {};
  const previousDecisionPrompt =
    typeof currentMetadata.decisionPrompt === "string"
      ? currentMetadata.decisionPrompt
      : null;
  const resolvedBy =
    typeof params.input.resolvedBy === "string" &&
    params.input.resolvedBy.trim().length > 0
      ? params.input.resolvedBy.trim()
      : null;
  const response = params.input.response.trim();

  return {
    metadata: {
      ...currentMetadata,
      feedbackNeeded: false,
      decisionPrompt: null,
      autonomousDecision: false,
      resolutionRationale: response,
      humanDecisionResponse: response,
      humanDecisionResolvedAt: params.resolvedAt,
      humanDecisionResolvedBy: resolvedBy,
      originalDecisionPrompt:
        previousDecisionPrompt ??
        currentMetadata.originalDecisionPrompt ??
        null,
    },
    previousDecisionPrompt,
    resolvedBy,
    response,
  };
}

export function buildWorkflowRunRequest(params: {
  project_id: string;
  workItemId: string;
  workflowId: string;
  launchSource: string;
  requestedBy?: string;
  idempotencyKey: string;
  action: "dispatch" | "review" | "merge";
  decision?: "approve" | "reject";
  feedback?: string;
  correlationId?: string | null;
  causationId?: string | null;
  // The work item's execution config (base/target branch, worktree path).
  // Surfaced into the trigger as `resource.executionConfig` so workflows that
  // read `{{ trigger.resource.executionConfig.baseBranch }}` (e.g. the merge
  // workflow) resolve their branches. Without it, merge_prepare fails with
  // "requires base_branch and target_branch". The lifecycle/dispatch paths
  // carry the same resource via their domain-event payload; this keeps the
  // direct run-request path (e.g. the manual merge endpoint) consistent.
  executionConfig?: Record<string, unknown> | null;
}): WorkflowRunRequestV1 {
  const finalCorrelationId = params.correlationId ?? randomUUID();
  const finalCausationId =
    params.causationId ??
    `kanban:work-item:${params.action}:${params.workItemId}`;

  const input: Record<string, unknown> = {
    scopeId: params.project_id,
    contextId: params.workItemId,
    action: params.action,
    ...(params.decision ? { decision: params.decision } : {}),
    ...(params.feedback ? { feedback: params.feedback } : {}),
    ...(params.executionConfig
      ? { resource: { executionConfig: params.executionConfig } }
      : {}),
  };

  return {
    workflow_id: params.workflowId,
    input,
    launch_source: params.launchSource,
    context: {
      scopeId: null,
      contextId: params.project_id,
      contextType: "kanban.project",
      metadata: { work_item_id: params.workItemId },
      scopeNodeId: null,
      scopePath: null,
    },
    metadata: {
      correlation_id: finalCorrelationId,
      causation_id: finalCausationId,
      idempotency_key: params.idempotencyKey,
      requested_by: params.requestedBy ?? null,
    },
    ...(resolveKanbanExternalMcpMounts()
      ? { external_mcp_mounts: resolveKanbanExternalMcpMounts() }
      : {}),
  };
}

export type { TransitionGateResult } from "./work-item.service.helpers.types";

const PASSING_STATUSES = new Set(["passed", "skipped"]);

export async function runTransitionGate(params: {
  project_id: string;
  workItemId: string;
  targetStatus: WorkItemStatus;
  hook: "before" | "after";
  blocking: boolean;
  projects: KanbanProjectRepository;
  coreClient: CoreWorkflowRequester;
  payload?: Record<string, unknown>;
}): Promise<TransitionGateResult> {
  const project = await params.projects.findById(params.project_id);
  if (!project) {
    throw new NotFoundException(`Project ${params.project_id} not found`);
  }

  const settings = resolveRepositoryWorkflowSettings(
    project.repository_workflow_settings,
  );
  if (!settings.enabled) {
    return { aggregateStatus: "disabled", blocked: false, failures: [] };
  }

  const request: WorkflowLifecycleExecutionRequest = {
    scopeId: params.project_id,
    contextId: params.workItemId,
    phase: params.targetStatus,
    hook: params.hook,
    blockingOnly: params.hook === "before",
    ...(params.payload ? { payload: params.payload } : {}),
  };

  const result = await params.coreClient.executeLifecycleWorkflows(request);

  const failures: LifecycleGateFailure[] = result.results
    .filter((r: { status: string }) => !PASSING_STATUSES.has(r.status))
    .map(
      (r: {
        workflowName: string;
        status: string;
        error?: string | null;
        runId?: string | null;
      }) => ({
        workflowName: r.workflowName,
        status: r.status,
        error: r.error ?? null,
        runId: r.runId ?? null,
      }),
    );

  const blocked = params.blocking && !PASSING_STATUSES.has(result.status);

  return { aggregateStatus: result.status, blocked, failures };
}

function asLifecycleRecord(
  metadata: Record<string, unknown> | null | undefined,
): {
  base: Record<string, unknown>;
  lifecycle: Record<string, unknown>;
} {
  const base = isRecord(metadata) ? { ...metadata } : {};
  const lifecycle = isRecord(base.lifecycle) ? { ...base.lifecycle } : {};
  return { base, lifecycle };
}

export function mergeGateHeldMetadata(params: {
  metadata: Record<string, unknown> | null | undefined;
  targetStatus: string;
  heldAt: string;
  failures: LifecycleGateFailure[];
}): Record<string, unknown> {
  const { base, lifecycle } = asLifecycleRecord(params.metadata);
  lifecycle.gate = {
    targetStatus: params.targetStatus,
    hook: "before",
    status: "held",
    heldAt: params.heldAt,
    failures: params.failures,
  };
  base.lifecycle = lifecycle;
  return base;
}

export function clearGateMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const { base, lifecycle } = asLifecycleRecord(metadata);
  delete lifecycle.gate;
  base.lifecycle = lifecycle;
  return base;
}

export function buildTransitionPayload(params: {
  item: { id: string; title: string; status: string };
  fromStatus: string;
  toStatus: string;
  hook: "before" | "after";
}): Record<string, unknown> {
  return {
    workItem: {
      id: params.item.id,
      title: params.item.title,
      status: params.item.status,
    },
    transition: { from: params.fromStatus, to: params.toStatus },
    hook: params.hook,
  };
}

export async function toRecordsWithDependencies(
  items: WorkItemEntityRecord[],
  workItems: KanbanWorkItemRepository,
): Promise<WorkItemRecord[]> {
  if (items.length === 0) return [];
  const dependencies = await workItems.findDependenciesByWorkItemIds(
    items.map((item) => item.id),
  );
  const byWorkItemId = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = byWorkItemId.get(dependency.work_item_id) ?? [];
    list.push(dependency.depends_on_work_item_id);
    byWorkItemId.set(dependency.work_item_id, list);
  }

  const subtasks = await workItems.findSubtasksByWorkItemIds(
    items.map((item) => item.id),
  );
  const subtasksByWorkItemId = new Map<string, WorkItemSubtaskRecord[]>();
  for (const subtask of subtasks) {
    const list = subtasksByWorkItemId.get(subtask.work_item_id) ?? [];
    list.push(subtask);
    subtasksByWorkItemId.set(subtask.work_item_id, list);
  }
  return items.map((item) =>
    toWorkItemRecord(
      item,
      byWorkItemId.get(item.id) ?? [],
      subtasksByWorkItemId.get(item.id) ?? [],
    ),
  );
}

export async function assertDependenciesExist(params: {
  project_id: string;
  dependencyIds: string[];
  workItems: KanbanWorkItemRepository;
}): Promise<void> {
  for (const dependencyId of params.dependencyIds) {
    const dependency = await params.workItems.findByProjectAndId(
      params.project_id,
      dependencyId,
    );
    if (!dependency) {
      throw new BadRequestException(
        `Dependency work item ${dependencyId} not found`,
      );
    }
  }
}
