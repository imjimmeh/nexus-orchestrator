import type { RuntimeToolchainConfig } from "@nexus/core";
import type { DispatchServiceDeps } from "./dispatch-internal.types";

/**
 * The union of dependencies required to execute the unified dispatch core.
 * Mirrors the existing `DispatchServiceDeps` shape so the service can pass its
 * members through directly, while keeping the core decoupled from NestJS
 * injection.
 */
export interface DispatchCoreDeps {
  coreClient: DispatchServiceDeps["coreClient"];
  requestContext: DispatchServiceDeps["requestContext"];
  workItems: DispatchServiceDeps["workItems"];
  workItemService?: DispatchServiceDeps["workItemService"];
  /**
   * Resolver for the per-project active-work budget. The service falls back to
   * Kanban settings, while the core accepts a plain number for testability.
   */
  resolveMaxActivePerProject?: () => Promise<number>;
  /**
   * Project reader used to load the dispatched project's `runtime_toolchains`
   * column, threaded into the neutral `runtime_toolchains` launch input on
   * every dispatched run request (Task 16). Optional so callers/tests that
   * don't exercise runtime toolchains aren't forced to supply it — when
   * omitted, dispatched runs simply carry no `runtime_toolchains` input.
   */
  projects?: {
    findById(
      id: string,
    ): Promise<{ runtime_toolchains?: RuntimeToolchainConfig | null } | null>;
  };
}

/**
 * Options bag for the unified `dispatchWorkItems` core.
 *
 * The two public entry points (`DispatchService.dispatchReadyWorkItems` and
 * `DispatchService.dispatchSelectedWorkItems`) translate their respective
 * inputs into one of two preconfigured option bundles. The core then branches
 * on these flags instead of duplicating per-path loops.
 *
 * Mode is determined by the presence of `selectedWorkItemIds`:
 *   - undefined → ready-all mode (default options below assume this mode).
 *   - defined   → selected-only mode (the caller sets the override flags).
 */
export interface DispatchCoreOptions {
  /** Project whose items are being dispatched. */
  projectId: string;
  /** Workflow id to dispatch under. */
  workflowId: string;
  /** Optional actor recorded on the emitted workflow run metadata. */
  requestedBy?: string;

  /**
   * When defined, restricts the launch loop to these work-item ids
   * (selected-mode). When undefined, every project item is a candidate
   * (ready-mode).
   */
  selectedWorkItemIds?: string[];

  /**
   * Whether to reconcile stale terminal linked runs before dispatch.
   * Ready-mode default: true. Selected-mode is always-on regardless.
   */
  reconcileRunStatus?: boolean;

  /**
   * Whether to reset orphaned in-progress items to todo.
   * Ready-mode default: true. Selected-mode default: false.
   */
  reconcileOrphans?: boolean;

  /**
   * Whether to run target-file contention + branch claim checks via
   * `claimDispatchSlot`. Ready-mode default: true. Selected-mode default: false.
   */
  checkTargetFileContention?: boolean;

  /**
   * Whether to wrap per-item launches in try/catch and emit a `dispatch_failed`
   * skip on errors. Selected-mode default: true. Ready-mode default: false.
   */
  partialFailure?: boolean;

  /** Ready-mode dispatch limit. Caller-supplied; defaults to no limit. */
  limit?: number;

  /** Selected-mode dispatch slot cap. Caller-supplied; defaults to no cap. */
  slots?: number;

  /**
   * Skip reason emitted when `agentCapacityReached` triggers. The ready-mode
   * uses `agent_capacity_reached`; the selected-mode uses `concurrency_exceeded`.
   */
  capacitySkipReason?: "agent_capacity_reached" | "concurrency_exceeded";

  /**
   * Causation-id prefix used when building the dispatched workflow run
   * request. Ready-mode uses `kanban:dispatch`; selected-mode uses
   * `kanban:dispatch:selected`.
   */
  causationIdPrefix?: "kanban:dispatch" | "kanban:dispatch:selected";

  /** Per-agent concurrency budget (consumed by `agentCapacityReached`). */
  maxConcurrentPerAgent?: number;

  /** Per-project active-work budget; resolved from settings when undefined. */
  maxActivePerProject?: number;

  /**
   * Whether to release a claimed target branch when a dispatch attempt fails
   * (only relevant in selected-mode with partial-failure semantics). Ready-mode
   * is fail-fast and never releases claims.
   */
  releaseBranchOnFailure?: boolean;

  /**
   * When true, todo candidates that never cleared refinement are rerouted to
   * refinement instead of dispatched. Resolved from the
   * `work_item_preflight_required` kanban setting by the service layer.
   */
  preflightRequired?: boolean;
}

/**
 * Filters used by the selected-mode reconciler to decide which linked runs
 * are eligible for stale-run reconciliation (other linked runs are skipped).
 */
export interface ReconcileScope {
  selectedIds: Set<string>;
  selectedAgentIds: Set<string>;
  selectedTargetBranches: Set<string>;
}
