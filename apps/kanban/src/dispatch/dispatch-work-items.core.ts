import type { RuntimeToolchainConfig } from "@nexus/core";
import type {
  DependencyRecord,
  WorkItemRecord,
} from "./dispatch-internal.types";
import {
  agentCapacityReached,
  countActiveLinkedByAgent,
  dependenciesReady,
  groupDependencyIds,
  incrementActiveAgentCount,
  recordAlreadyLinkedDispatch,
  wasCoreStatusUnavailable,
} from "./dispatch-candidate.helpers";
import {
  countActiveProjectDispatches,
  resolveProjectDispatchCapacityFromActiveCount,
} from "./project-dispatch-capacity";
import { buildRunRequest, linkAcceptedRun } from "./dispatch-run-link.helper";
import { isContainerCandidate } from "./dispatch-container.helper";
import {
  claimDispatchSlot,
  collectActiveTargetBranches,
} from "./dispatch-target-branch.helper";
import { getTargetBranch } from "./target-branch-claims";
import type {
  DispatchCoreDeps,
  DispatchCoreOptions,
} from "./dispatch-core.types";
import type { DispatchResult } from "./dispatch.service.types";
import {
  reconcileOrphans,
  reconcileStaleRuns,
  refreshRequestedItems,
} from "./dispatch-work-items-reconciliation";
import {
  readRefinementRoutingMeta,
  shouldGateDispatchToRefinement,
} from "../work-item/work-item-preflight-routing.helper";

export type { DispatchCoreOptions } from "./dispatch-core.types";
export type { DispatchCoreDeps } from "./dispatch-core.types";

/**
 * Unified core that drives both `DispatchService.dispatchReadyWorkItems`
 * (ready-mode options) and `DispatchService.dispatchSelectedWorkItems`
 * (selected-mode options). Behavioural parity with the M2 implementation is
 * preserved by branching on `options` flags instead of duplicating loops.
 */
export async function dispatchWorkItems(
  deps: DispatchCoreDeps,
  options: DispatchCoreOptions,
): Promise<DispatchResult> {
  const ctx = await prepareDispatchContext(deps, options);

  for (const workItemId of ctx.candidateIds) {
    await processCandidate(ctx, workItemId);
  }

  return ctx.result;
}

interface DispatchContext {
  options: DispatchCoreOptions;
  selectedMode: boolean;
  deps: DispatchCoreDeps;
  result: DispatchResult;
  /** The dispatched project's `runtime_toolchains`, when a project reader was supplied. */
  projectRuntimeToolchains?: RuntimeToolchainConfig | null;
  projectItems: WorkItemRecord[];
  /** Every `parent_work_item_id` present among `projectItems` — a work item whose id appears here currently has children and must never be dispatched. */
  childrenParentIds: Set<string>;
  dependencyIdsByItem: Map<string, string[]>;
  itemById: Map<string, WorkItemRecord>;
  activeByAgent: Map<string, number>;
  claimedTargetBranches: Set<string>;
  inFlightItems: WorkItemRecord[];
  initialProjectActiveCount: number;
  maxActivePerProject: number;
  maxItems: number;
  targetBranchCheck: boolean;
  requestedById: Map<string, WorkItemRecord>;
  candidateIds: string[];
  launchedCount: number;
  acceptedProjectLaunches: number;
}

async function prepareDispatchContext(
  deps: DispatchCoreDeps,
  options: DispatchCoreOptions,
): Promise<DispatchContext> {
  const selectedMode = options.selectedWorkItemIds !== undefined;
  const result: DispatchResult = {
    dispatched: [],
    skipped: [],
    reconciled: [],
    orphanReconciled: [],
  };
  const maxItems = options.limit ?? options.slots ?? Number.POSITIVE_INFINITY;
  const targetBranchCheck = options.checkTargetFileContention ?? !selectedMode;
  const maxActivePerProject = await resolveMaxActivePerProject(
    deps,
    options.maxActivePerProject,
  );
  const projectRuntimeToolchains = await loadProjectRuntimeToolchains(
    deps,
    options.projectId,
  );
  const projectItems = await loadProjectItems(deps, options.projectId);
  const dependencies = await loadProjectDependencies(deps, projectItems);
  const requestedItems = await loadRequestedItems(deps, options);
  const requestedById = new Map(requestedItems.map((item) => [item.id, item]));

  if (options.reconcileRunStatus ?? selectedMode) {
    await reconcileStaleRuns(deps, {
      selectedMode,
      options,
      projectItems,
      requestedItems,
      requestedById,
      result,
    });
  }

  if (options.reconcileOrphans ?? !selectedMode) {
    await reconcileOrphans(deps, projectItems, result);
  }

  if (selectedMode) {
    await refreshRequestedItems(deps, options, requestedById);
  }

  const childrenParentIds = new Set(
    projectItems
      .map((item) => item.parent_work_item_id)
      .filter((id): id is string => id != null),
  );
  const dependencyIdsByItem = groupDependencyIds(dependencies);
  const itemById = new Map(projectItems.map((item) => [item.id, item]));
  const activeByAgent = countActiveLinkedByAgent(projectItems);
  const claimedTargetBranches = collectActiveTargetBranches(projectItems);
  const inFlightItems = projectItems.filter(
    (candidate) =>
      candidate.linked_run_id != null ||
      candidate.status === "in-progress" ||
      candidate.status === "in-review",
  );
  const initialProjectActiveCount = countActiveProjectDispatches(projectItems);
  const candidateIds = buildCandidateList(options, projectItems);

  return {
    options,
    selectedMode,
    deps,
    result,
    projectRuntimeToolchains,
    projectItems,
    childrenParentIds,
    dependencyIdsByItem,
    itemById,
    activeByAgent,
    claimedTargetBranches,
    inFlightItems,
    initialProjectActiveCount,
    maxActivePerProject,
    maxItems,
    targetBranchCheck,
    requestedById,
    candidateIds,
    launchedCount: 0,
    acceptedProjectLaunches: 0,
  };
}

async function processCandidate(
  ctx: DispatchContext,
  workItemId: string,
): Promise<void> {
  const item = resolveCandidate(ctx, workItemId);
  if (!item) return;

  if (wasCoreStatusUnavailable(item, ctx.result)) return;

  if (recordAlreadyLinkedDispatch(item, ctx.result)) return;

  if (item.status !== "todo") {
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "not_dispatchable_status",
      status: item.status,
    });
    return;
  }

  if (isContainerCandidate(item, ctx.childrenParentIds)) {
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "container_not_dispatchable",
      status: item.status,
    });
    return;
  }

  if (await applyRefinementGate(ctx, item)) return;

  const projectCapacity = resolveProjectDispatchCapacityFromActiveCount(
    ctx.initialProjectActiveCount,
    ctx.maxActivePerProject,
    ctx.acceptedProjectLaunches,
  );

  const preFlight = runPreFlight(ctx, item, projectCapacity);
  if (preFlight === "silent-limit-stop") return;
  if (preFlight) {
    ctx.result.skipped.push(preFlight);
    return;
  }

  if (!claimOrSkipBranch(ctx, item)) return;

  const launchResult = await launchWithFailureMode(ctx, item);

  if (launchResult.outcome === "launched") {
    ctx.launchedCount += 1;
    ctx.acceptedProjectLaunches += 1;
    return;
  }
  if (launchResult.outcome === "claimed-but-failed") {
    ctx.launchedCount += 1;
    ctx.acceptedProjectLaunches += 1;
    incrementActiveAgentCount(item, ctx.activeByAgent);
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "dispatch_failed",
      detail: launchResult.detail,
    });
    return;
  }
  if (launchResult.outcome === "skipped") {
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "dispatch_failed",
      detail: launchResult.detail,
    });
    return;
  }
  if (launchResult.outcome === "silent-throw") {
    throw launchResult.error;
  }
}

function resolveCandidate(
  ctx: DispatchContext,
  workItemId: string,
): WorkItemRecord | undefined {
  if (!ctx.selectedMode) {
    return ctx.itemById.get(workItemId);
  }
  const requested = ctx.requestedById.get(workItemId);
  if (!requested) {
    ctx.result.skipped.push({
      workItemId,
      reason: "work_item_not_found",
    });
    return undefined;
  }
  if (requested.project_id !== ctx.options.projectId) {
    ctx.result.skipped.push({
      workItemId,
      reason: "work_item_cross_project",
    });
    return undefined;
  }
  return requested;
}

/**
 * Applies the refinement preflight gate to a todo candidate. When
 * `preflightRequired` is set and the item has never cleared refinement, the
 * item is transitioned to `refinement` and recorded as skipped.
 *
 * Returns true when the gate fired and the caller should stop processing the
 * candidate; false when dispatch may proceed normally.
 */
async function applyRefinementGate(
  ctx: DispatchContext,
  item: WorkItemRecord,
): Promise<boolean> {
  if (!ctx.options.preflightRequired || !ctx.deps.workItemService) return false;
  const meta = readRefinementRoutingMeta(item.metadata);
  if (
    !shouldGateDispatchToRefinement({
      hasClearedRefinementOnce: meta.hasClearedRefinementOnce,
      preflightRequired: true,
    })
  ) {
    return false;
  }
  await ctx.deps.workItemService.updateStatus(
    item.project_id,
    item.id,
    "refinement",
  );
  ctx.result.skipped.push({
    workItemId: item.id,
    reason: "refinement_required",
  });
  return true;
}

interface PreFlightSkip {
  workItemId: string;
  reason:
    | "dispatch_slot_limit_reached"
    | "project_wip_limit_reached"
    | "dependencies_not_ready"
    | "concurrency_exceeded"
    | "agent_capacity_reached"
    | "refinement_required";
}

type PreFlightResult = PreFlightSkip | "silent-limit-stop" | undefined;

function runPreFlight(
  ctx: DispatchContext,
  item: WorkItemRecord,
  projectCapacity: ReturnType<
    typeof resolveProjectDispatchCapacityFromActiveCount
  >,
): PreFlightResult {
  const silentLimit = !ctx.selectedMode;

  if (ctx.launchedCount >= ctx.maxItems) {
    if (silentLimit) return "silent-limit-stop";
    return {
      workItemId: item.id,
      reason: "dispatch_slot_limit_reached",
    };
  }

  if (!projectCapacity.canLaunchNewWork) {
    return {
      workItemId: item.id,
      reason: "project_wip_limit_reached",
    };
  }

  if (!dependenciesReady(item, ctx.dependencyIdsByItem, ctx.itemById)) {
    return {
      workItemId: item.id,
      reason: "dependencies_not_ready",
    };
  }

  if (agentCapacityReached(ctx.options, item, ctx.activeByAgent)) {
    const reason = resolveCapacitySkipReason(ctx.options, ctx.selectedMode);
    return {
      workItemId: item.id,
      reason,
    };
  }

  return undefined;
}

function resolveCapacitySkipReason(
  options: DispatchCoreOptions,
  selectedMode: boolean,
): "agent_capacity_reached" | "concurrency_exceeded" {
  if (options.capacitySkipReason) return options.capacitySkipReason;
  return selectedMode ? "concurrency_exceeded" : "agent_capacity_reached";
}

function claimOrSkipBranch(
  ctx: DispatchContext,
  item: WorkItemRecord,
): boolean {
  if (ctx.targetBranchCheck) {
    return claimDispatchSlot(item, {
      claimedTargetBranches: ctx.claimedTargetBranches,
      inFlightItems: ctx.inFlightItems,
      result: ctx.result,
    });
  }
  const targetBranch = getTargetBranch(item);
  if (targetBranch && ctx.claimedTargetBranches.has(targetBranch)) {
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "target_branch_already_dispatched",
      detail: targetBranch,
    });
    return false;
  }
  if (targetBranch) ctx.claimedTargetBranches.add(targetBranch);
  return true;
}

interface LaunchOutcome {
  outcome: "launched" | "claimed-but-failed" | "skipped" | "silent-throw";
  detail?: string;
  error?: unknown;
}

async function launchWithFailureMode(
  ctx: DispatchContext,
  item: WorkItemRecord,
): Promise<LaunchOutcome> {
  if (!ctx.options.partialFailure) {
    await launchCandidate(ctx, item);
    return { outcome: "launched" };
  }

  try {
    await launchCandidate(ctx, item);
    return { outcome: "launched" };
  } catch (error: unknown) {
    if (isAcceptedRunLinkError(error)) {
      return {
        outcome: "claimed-but-failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    const targetBranch = getTargetBranch(item);
    if (targetBranch && ctx.options.releaseBranchOnFailure !== false) {
      ctx.claimedTargetBranches.delete(targetBranch);
    }
    return {
      outcome: "skipped",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function isAcceptedRunLinkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AcceptedRunLinkError" &&
    error.message.length > 0
  );
}

async function launchCandidate(
  ctx: DispatchContext,
  item: WorkItemRecord,
): Promise<void> {
  const accepted = await ctx.deps.coreClient.requestWorkflowRun(
    buildRunRequest({
      requestContext: ctx.deps.requestContext,
      projectId: ctx.options.projectId,
      workflowId: ctx.options.workflowId,
      item,
      dependencyIds: ctx.dependencyIdsByItem.get(item.id) ?? [],
      requestedBy: ctx.options.requestedBy,
      causationIdScope:
        ctx.options.causationIdPrefix === "kanban:dispatch:selected"
          ? "selected"
          : undefined,
      project: { runtime_toolchains: ctx.projectRuntimeToolchains },
    }),
  );

  let saved: WorkItemRecord;
  try {
    saved = await linkAcceptedRun(ctx.deps.workItems, item, accepted);
  } catch (error: unknown) {
    const wrapped = new Error(
      error instanceof Error ? error.message : String(error),
    );
    wrapped.name = "AcceptedRunLinkError";
    throw wrapped;
  }

  incrementActiveAgentCount(item, ctx.activeByAgent);
  ctx.result.dispatched.push({
    workItemId: item.id,
    runId: accepted.run_id,
    linkedRunId: saved.linked_run_id ?? accepted.run_id,
    currentExecutionId: saved.current_execution_id ?? null,
    status: saved.status,
    idempotent: false,
    mutationConfirmed: true,
  });
}

async function resolveMaxActivePerProject(
  deps: DispatchCoreDeps,
  override: number | undefined,
): Promise<number> {
  if (override !== undefined) return override;
  if (deps.resolveMaxActivePerProject) {
    return deps.resolveMaxActivePerProject();
  }
  return Number.POSITIVE_INFINITY;
}

async function loadProjectRuntimeToolchains(
  deps: DispatchCoreDeps,
  projectId: string,
): Promise<RuntimeToolchainConfig | null | undefined> {
  if (!deps.projects) return undefined;
  const project = await deps.projects.findById(projectId);
  return project?.runtime_toolchains;
}

async function loadProjectItems(
  deps: DispatchCoreDeps,
  projectId: string,
): Promise<WorkItemRecord[]> {
  return deps.workItems.findByproject_id(projectId);
}

async function loadProjectDependencies(
  deps: DispatchCoreDeps,
  projectItems: WorkItemRecord[],
): Promise<DependencyRecord[]> {
  return deps.workItems.findDependenciesByWorkItemIds(
    projectItems.map((item) => item.id),
  );
}

async function loadRequestedItems(
  deps: DispatchCoreDeps,
  options: DispatchCoreOptions,
): Promise<WorkItemRecord[]> {
  if (!options.selectedWorkItemIds) return [];
  return deps.workItems.findByIds(options.selectedWorkItemIds);
}

function buildCandidateList(
  options: DispatchCoreOptions,
  projectItems: WorkItemRecord[],
): string[] {
  if (options.selectedWorkItemIds) {
    return options.selectedWorkItemIds.slice();
  }
  return projectItems.map((item) => item.id);
}
