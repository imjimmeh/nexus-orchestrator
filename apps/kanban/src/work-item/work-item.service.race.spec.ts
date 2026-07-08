import { ConflictException, NotFoundException } from "@nestjs/common";
import type {
  BaseRequestContextService,
  CoreWorkflowEventEnvelopeV1Shape,
  WorkflowLifecycleExecutionResult,
  WorkflowRunAcceptedV1,
  WorkflowRunRequestV1,
} from "@nexus/core";
import { CoreWorkflowRunEventEnvelopeV1Schema } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "../orchestration/control-plane/control-plane.types";
import { linkWorkItemRunFromLifecycleEvent } from "../core/core-lifecycle-stream-work-item-link.helpers";
import { WorkItemService } from "./work-item.service";
import { WorkItemRunLeaseService } from "./work-item-run-lease";

type WorkItemEntity = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  scope: "standard" | "large";
  assigned_agent_id: string | null;
  token_spend: number;
  current_execution_id: string | null;
  waiting_for_input: boolean;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  linked_run_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AcceptedResponse = WorkflowRunAcceptedV1;

// ---------------------------------------------------------------------------
// InMemoryOrchestrationLeaseRepository
//
// Mirrors the kanban-orchestration-lease.repository contract in pure JS so
// the race-condition tests can use the *real* OrchestrationLeaseService and
// WorkItemRunLeaseService code paths without a Postgres lease table. The
// acquire() method does the same lazy-reclaim-then-insert sequence as the
// TypeORM-backed repository; tests reuse this fixture because there is no
// test-only seam in the production service.
// ---------------------------------------------------------------------------
interface InMemoryLeaseRecord {
  id: string;
  project_id: string;
  conflict_key_kind: OrchestrationConflictKey["kind"];
  conflict_key_value: string;
  lane: OrchestrationLane;
  owner_kind: OrchestrationLeaseOwnerKind;
  owner_id: string;
  status: OrchestrationLeaseStatus;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
  released_at: Date | null;
  metadata: Record<string, unknown> | null;
}

let nextLeaseSeq = 0;
function newLeaseId(): string {
  return `lease-${++nextLeaseSeq}`;
}

class InMemoryOrchestrationLeaseRepository {
  readonly store: InMemoryLeaseRecord[] = [];

  acquire(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    const keys = [...input.conflictKeys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );

    this.reclaimExpired(input.projectId, keys, now);

    const conflictingRows = this.findActiveConflicts(input.projectId, keys);
    if (conflictingRows.length > 0) {
      const conflicts: LeaseConflict[] = conflictingRows.map((row) => ({
        conflictKey: {
          kind: row.conflict_key_kind,
          value: row.conflict_key_value,
        },
        heldByOwnerKind: row.owner_kind,
        heldByOwnerId: row.owner_id,
        expiresAt: row.expires_at.toISOString(),
      }));
      return Promise.resolve({ acquired: false, conflicts });
    }

    const leaseIds: string[] = [];
    for (const key of keys) {
      const record: InMemoryLeaseRecord = {
        id: newLeaseId(),
        project_id: input.projectId,
        conflict_key_kind: key.kind,
        conflict_key_value: key.value,
        lane: input.lane,
        owner_kind: input.owner.kind,
        owner_id: input.owner.id,
        status: "active",
        acquired_at: now,
        heartbeat_at: now,
        expires_at: expiresAt,
        released_at: null,
        metadata: input.metadata ?? null,
      };
      this.store.push(record);
      leaseIds.push(record.id);
    }

    return Promise.resolve({ acquired: true, leaseIds });
  }

  release(leaseId: string, ownerId: string): Promise<boolean> {
    const record = this.store.find(
      (r) =>
        r.id === leaseId && r.owner_id === ownerId && r.status === "active",
    );
    if (!record) return Promise.resolve(false);
    record.status = "released";
    record.released_at = new Date();
    return Promise.resolve(true);
  }

  releaseAllForProject(projectId: string): Promise<number> {
    const active = this.store.filter(
      (r) => r.project_id === projectId && r.status === "active",
    );
    const now = new Date();
    for (const record of active) {
      record.status = "released";
      record.released_at = now;
    }
    return Promise.resolve(active.length);
  }

  heartbeat(leaseId: string, ttlMs: number): Promise<void> {
    const now = new Date();
    const record = this.store.find(
      (r) => r.id === leaseId && r.status === "active",
    );
    if (record) {
      record.heartbeat_at = now;
      record.expires_at = new Date(now.getTime() + ttlMs);
    }
    return Promise.resolve();
  }

  expireOverdue(now: Date): Promise<InMemoryLeaseRecord[]> {
    const overdue = this.store.filter(
      (r) => r.status === "active" && r.expires_at < now,
    );
    for (const record of overdue) {
      record.status = "expired";
    }
    return Promise.resolve(overdue);
  }

  listActiveByProject(projectId: string): Promise<InMemoryLeaseRecord[]> {
    return Promise.resolve(
      this.store.filter(
        (r) => r.project_id === projectId && r.status === "active",
      ),
    );
  }

  countActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<number> {
    return Promise.resolve(
      this.store.filter(
        (r) =>
          r.project_id === projectId &&
          r.lane === lane &&
          r.status === "active",
      ).length,
    );
  }

  listActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<InMemoryLeaseRecord[]> {
    return Promise.resolve(
      this.store.filter(
        (r) =>
          r.project_id === projectId &&
          r.lane === lane &&
          r.status === "active",
      ),
    );
  }

  private reclaimExpired(
    projectId: string,
    keys: OrchestrationConflictKey[],
    now: Date,
  ): void {
    for (const key of keys) {
      for (const record of this.store) {
        if (
          record.project_id === projectId &&
          record.conflict_key_kind === key.kind &&
          record.conflict_key_value === key.value &&
          record.status === "active" &&
          record.expires_at < now
        ) {
          record.status = "expired";
        }
      }
    }
  }

  private findActiveConflicts(
    projectId: string,
    keys: OrchestrationConflictKey[],
  ): InMemoryLeaseRecord[] {
    const conflicts: InMemoryLeaseRecord[] = [];
    for (const key of keys) {
      const hit = this.store.find(
        (r) =>
          r.project_id === projectId &&
          r.conflict_key_kind === key.kind &&
          r.conflict_key_value === key.value &&
          r.status === "active",
      );
      if (hit) conflicts.push(hit);
    }
    return conflicts;
  }
}

describe("WorkItemService.requestWorkItemRun race-condition", () => {
  let service: WorkItemService;
  let items: Map<string, WorkItemEntity>;
  let capturedRequests: WorkflowRunRequestV1[];
  let lifecycleEventPublisherMock: {
    emitStatusChanged: ReturnType<typeof vi.fn>;
    emitHumanFeedbackResolved: ReturnType<typeof vi.fn>;
  };
  let leaseRepo: InMemoryOrchestrationLeaseRepository;
  let runLeaseService: WorkItemRunLeaseService;

  const workItemRepository = {
    save: vi.fn((input: Partial<WorkItemEntity>) => {
      const key = `${input.project_id}:${input.id}`;
      const existing = items.get(key);
      const now = new Date("2026-04-15T00:10:00.000Z");
      const entity: WorkItemEntity = {
        id: input.id as string,
        project_id: input.project_id as string,
        title: input.title ?? existing?.title ?? "",
        description: input.description ?? existing?.description ?? null,
        status: input.status ?? existing?.status ?? "todo",
        priority: input.priority ?? existing?.priority ?? "p2",
        scope: input.scope ?? existing?.scope ?? "standard",
        assigned_agent_id:
          input.assigned_agent_id ?? existing?.assigned_agent_id ?? null,
        token_spend: input.token_spend ?? existing?.token_spend ?? 0,
        current_execution_id:
          input.current_execution_id ?? existing?.current_execution_id ?? null,
        waiting_for_input:
          input.waiting_for_input ?? existing?.waiting_for_input ?? false,
        execution_config:
          input.execution_config ?? existing?.execution_config ?? null,
        metadata: input.metadata ?? existing?.metadata ?? null,
        linked_run_id: input.linked_run_id ?? existing?.linked_run_id ?? null,
        created_at:
          existing?.created_at ?? new Date("2026-04-15T00:00:00.000Z"),
        updated_at: now,
      };
      items.set(key, entity);
      return Promise.resolve(entity);
    }),
    findByProjectAndId: vi.fn((project_id: string, workItemId: string) =>
      Promise.resolve(items.get(`${project_id}:${workItemId}`) ?? null),
    ),
    findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
    findSubtasksByWorkItemIds: vi.fn(() => Promise.resolve([])),
    // Mirrors the production repository's race-safe conditional link: the
    // caller succeeds only if the link columns are currently null. This
    // matches the `WHERE linked_run_id IS NULL AND current_execution_id IS
    // NULL` guard the real `linkRunIfUnlinked` uses, so concurrent calls
    // cannot both observe an empty link and both insert a different value.
    linkRunIfUnlinked: vi.fn(
      (params: { project_id: string; workItemId: string; runId: string }) => {
        const key = `${params.project_id}:${params.workItemId}`;
        const existing = items.get(key);
        if (!existing) return Promise.resolve(false);
        if (
          existing.linked_run_id !== null ||
          existing.current_execution_id !== null
        ) {
          return Promise.resolve(false);
        }
        existing.linked_run_id = params.runId;
        existing.current_execution_id = params.runId;
        items.set(key, existing);
        return Promise.resolve(true);
      },
    ),
    findByProjectAndIdForUpdate: vi.fn(
      (project_id: string, workItemId: string) =>
        Promise.resolve(items.get(`${project_id}:${workItemId}`) ?? null),
    ),
    // This fixture's WorkItemEntity has no `type`/`parent_work_item_id`
    // fields (it predates the epic/story/task container model), so none
    // of these race-condition fixtures are containers — the dispatch
    // guard in `requestWorkItemRun` always sees an empty children set.
    existsChildrenFor: vi.fn(() => Promise.resolve(new Set<string>())),
  };

  const requestContext = {
    getRequestId: () => "corr-race",
    getCausationId: () => "cause-race",
  } as unknown as BaseRequestContextService;

  const projectsMock = {
    findById: vi.fn().mockResolvedValue({
      id: "project-1",
      repository_workflow_settings: { enabled: false },
    }),
  };

  const executeLifecycleWorkflowsMock =
    vi.fn<() => Promise<WorkflowLifecycleExecutionResult>>();

  function buildService(
    coreClientOverride?: {
      requestWorkflowRun: (
        request: WorkflowRunRequestV1,
      ) => Promise<AcceptedResponse>;
    },
    kanbanSettingsOverride?: {
      getBoolean: (key: string) => Promise<boolean>;
    },
  ): WorkItemService {
    const requestWorkflowRun =
      coreClientOverride?.requestWorkflowRun ??
      ((request: WorkflowRunRequestV1) => {
        capturedRequests.push(request);
        return Promise.resolve({
          run_id: `run-${capturedRequests.length}`,
          workflow_id: request.workflow_id,
          status: "accepted",
          accepted_at: "2026-04-13T00:00:00.000Z",
          metadata: { correlation_id: "corr-race" },
        } satisfies AcceptedResponse);
      });

    const defaultGetBoolean: (key: string) => Promise<boolean> = (key) =>
      Promise.resolve(key === "work_item_run_lease_enabled");
    return new WorkItemService(
      {
        requestWorkflowRun,
        executeLifecycleWorkflows: executeLifecycleWorkflowsMock,
        getProjectMountPolicy: vi.fn(),
        commitPaths: vi.fn(),
        listWorkflowRuns: vi.fn(),
      } as never,
      requestContext,
      workItemRepository as never,
      lifecycleEventPublisherMock as never,
      projectsMock as never,
      { publish: vi.fn().mockResolvedValue(undefined) } as never,
      { broadcastWorkItemUpdated: vi.fn() } as never,
      runLeaseService,
      // Lease rollback flag enabled (default). Individual tests
      // override `kanbanSettings.getBoolean` to exercise the disabled
      // path. See the rollback runbook at
      // docs/operations/README.md#work-item-run-link-lease-contention.
      {
        getBoolean: kanbanSettingsOverride?.getBoolean ?? defaultGetBoolean,
        getNumber: vi.fn(),
        get: vi.fn(),
        getAll: vi.fn(),
        set: vi.fn(),
        seedDefaults: vi.fn(),
        onModuleInit: vi.fn(),
      } as never,
      { estimate: vi.fn() } as never,
      { findAllForBucketAggregation: vi.fn() } as never,
    );
  }

  function addWorkItem(
    overrides: Partial<WorkItemEntity> = {},
  ): WorkItemEntity {
    const item: WorkItemEntity = {
      id: "work-item-1",
      project_id: "project-1",
      title: "Race candidate",
      description: null,
      status: "todo",
      priority: "p2",
      scope: "standard",
      assigned_agent_id: null,
      token_spend: 0,
      current_execution_id: null,
      waiting_for_input: false,
      execution_config: null,
      metadata: null,
      linked_run_id: null,
      created_at: new Date("2026-04-15T00:00:00.000Z"),
      updated_at: new Date("2026-04-15T00:00:00.000Z"),
      ...overrides,
    };
    items.set(`${item.project_id}:${item.id}`, item);
    return item;
  }

  function makeRunningEnvelope(): CoreWorkflowEventEnvelopeV1Shape {
    return CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-f3",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-15T00:00:00.000Z",
      correlation_id: "corr-f3",
      source_service: "core",
      payload: {
        run_id: "run-f3",
        workflow_id: "dispatch-work-item-flow",
        status: "RUNNING",
        context: {
          scopeId: "project-1",
          contextId: "work-item-1",
          contextType: "kanban.project",
          metadata: { work_item_id: "work-item-1" },
        },
      },
    });
  }

  beforeEach(() => {
    items = new Map();
    capturedRequests = [];
    vi.clearAllMocks();
    lifecycleEventPublisherMock = {
      emitStatusChanged: vi.fn().mockResolvedValue(undefined),
      emitHumanFeedbackResolved: vi.fn().mockResolvedValue(undefined),
    };
    workItemRepository.save.mockClear();
    workItemRepository.linkRunIfUnlinked.mockClear();
    workItemRepository.findByProjectAndIdForUpdate.mockClear();
    nextLeaseSeq = 0;
    leaseRepo = new InMemoryOrchestrationLeaseRepository();
    // Wire the real OrchestrationLeaseService + WorkItemRunLeaseService so
    // every requestWorkItemRun call goes through the production
    // acquire/release paths. The in-memory repository gives us real
    // serialisation across concurrent callers without a Postgres lease
    // table — see Milestone 2 for the original fixture.
    const orchestrationLeaseService = new OrchestrationLeaseService(
      leaseRepo as never,
    );
    runLeaseService = new WorkItemRunLeaseService(orchestrationLeaseService);
    service = buildService();
  });

  it("persists the run id and the linked_run_id / current_execution_id invariant on a single dispatch", async () => {
    addWorkItem();

    const result = await service.dispatchWorkItem("project-1", "work-item-1", {
      workflowId: "dispatch-work-item-flow",
    });

    expect(result.run_id).toBe("run-1");
    const stored = items.get("project-1:work-item-1");
    expect(stored?.linked_run_id).toBe("run-1");
    // The invariant: linked_run_id and current_execution_id must be set
    // together so capacity / dispatch / reconciliation all see the same
    // active run.
    expect(stored?.current_execution_id).toBe("run-1");
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledTimes(1);
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: "run-1",
    });
  });

  it("lets exactly one concurrent dispatch caller acquire the lease and rejects the loser with a conflict", async () => {
    addWorkItem();

    // Two concurrent dispatches for the same work item. With the
    // per-work-item lease in front of every requestWorkItemRun call, the
    // first caller to enter acquireRunLease wins; the second caller's
    // acquire returns acquired: false and surfaces a deterministic
    // ConflictException *before* any DB read or coreClient.requestWorkflowRun.
    // This closes the F1 window — the conditional linkRunIfUnlinked UPDATE
    // is no longer the only race-safety barrier on the hot path.
    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      service.dispatchWorkItem("project-1", "work-item-1", {
        workflowId: "dispatch-work-item-flow",
      }),
      service.dispatchWorkItem("project-1", "work-item-1", {
        workflowId: "dispatch-work-item-flow",
      }),
    ]);

    const fulfilled = [firstOutcome, secondOutcome].filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = [firstOutcome, secondOutcome].filter(
      (outcome) => outcome.status === "rejected",
    );

    // Exactly one caller succeeds; the lease guarantees the second call
    // is rejected before it can reach Core.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);

    // Only the winner reaches Core; the loser's requestWorkflowRun never
    // happens because the lease acquire short-circuits the call.
    expect(capturedRequests).toHaveLength(1);
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledTimes(1);

    // The final linked_run_id is the run the winner committed.
    const stored = items.get("project-1:work-item-1");
    expect(stored?.linked_run_id).toBe(
      (fulfilled[0] as PromiseFulfilledResult<{ run_id: string }>).value.run_id,
    );
    // The invariant holds: linked_run_id and current_execution_id agree
    // and reference the winning run, not the loser's would-be run.
    expect(stored?.current_execution_id).toBe(stored?.linked_run_id);
  });

  it("surfaces a deterministic conflict when the link columns are already populated", async () => {
    addWorkItem({
      linked_run_id: "run-prev",
      current_execution_id: "run-prev",
    });

    await expect(
      service.dispatchWorkItem("project-1", "work-item-1", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("throws NotFoundException for a missing work item and does not attempt the link", async () => {
    await expect(
      service.dispatchWorkItem("project-1", "missing", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(workItemRepository.linkRunIfUnlinked).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // F2 — Concurrent dispatchWorkItem + submitReviewDecision(approve)
  //
  // Both actions go through requestWorkItemRun and target the same
  // (project_id, work_item_id) tuple. The per-work-item lease closes
  // the F2 window: exactly one of the two callers wins the lease; the
  // loser receives a deterministic ConflictException *before* invoking
  // Core, so the loser's status mutation (transitionStatus for
  // review.approve, or any pre-link save) never persists.
  // -------------------------------------------------------------------------
  it("F2 — serializes concurrent dispatchWorkItem + submitReviewDecision(approve) on the same work item", async () => {
    addWorkItem({ status: "in-review" });

    // Snapshot the work item before the race so the post-call assertions
    // can verify "no phantom writes" for the loser.
    const before = items.get("project-1:work-item-1");
    const snapshot = {
      status: before?.status,
      metadata: before?.metadata,
      linked_run_id: before?.linked_run_id,
      current_execution_id: before?.current_execution_id,
    };

    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      service.dispatchWorkItem("project-1", "work-item-1", {
        workflowId: "dispatch-work-item-flow",
      }),
      service.submitReviewDecision("project-1", "work-item-1", {
        decision: "approve",
        workflowId: "review-workflow",
      }),
    ]);

    const fulfilled = [firstOutcome, secondOutcome].filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = [firstOutcome, secondOutcome].filter(
      (outcome) => outcome.status === "rejected",
    );

    // Invariant 1: exactly one run id wins.
    expect(fulfilled).toHaveLength(1);
    const winningRunId = (
      fulfilled[0] as PromiseFulfilledResult<{
        run_id: string;
      }>
    ).value.run_id;

    // Invariant 2: the loser receives a deterministic ConflictException,
    // not some other error class.
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);

    // Invariant 3: zero phantom writes. The Core call only happens for
    // the winning caller; the loser's request never reaches Core.
    expect(capturedRequests).toHaveLength(1);
    // The link write is also a single call — the loser's linkRunIfUnlinked
    // never runs because the lease acquire short-circuits the call.
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledTimes(1);

    // Invariant 4: the work item's persisted state matches the winner.
    const stored = items.get("project-1:work-item-1");
    expect(stored?.linked_run_id).toBe(winningRunId);
    expect(stored?.current_execution_id).toBe(winningRunId);
    // The snapshot fields the loser never touched must still match the
    // pre-call snapshot — i.e. the loser's status transition or
    // metadata mutation was never persisted.
    if (stored?.status !== snapshot.status) {
      throw new Error(
        `expected status ${snapshot.status}, got ${stored?.status} — the loser's status mutation may have persisted`,
      );
    }
    expect(stored?.metadata).toEqual(snapshot.metadata);

    // The lease row is gone — the winner's try/finally released it.
    const active = await leaseRepo.listActiveByProject("project-1");
    expect(active).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // F3 — Lifecycle projection interleaved with requestWorkItemRun
  //
  // The lifecycle stream consumer's linkWorkItemRunFromLifecycleEvent
  // helper participates in the per-work-item lease protocol (action:
  // "lifecycle_link"). When a requestWorkItemRun call is in flight,
  // the projection loses the lease and does *not* write any link.
  // When the holder releases the lease, the next projection attempt
  // succeeds — this is the "retries on the next poll" semantics.
  // -------------------------------------------------------------------------
  it("F3 — lifecycle-projection loses to a freshly acquired lease and retries on the next poll", async () => {
    addWorkItem();

    // Step 1: simulate an in-flight requestWorkItemRun by acquiring the
    // dispatch lease directly through the work-item-run lease service.
    // This is the "freshly acquired lease" the projection must lose to.
    const heldByRequest = await runLeaseService.acquireRunLease({
      projectId: "project-1",
      workItemId: "work-item-1",
      action: "dispatch",
      ownerId: "in-flight-request",
    });
    expect(heldByRequest.acquired).toBe(true);

    // Step 2: the lifecycle projection tries to link a freshly arrived
    // run event. Because the dispatch lease is held, the projection
    // must observe acquired: false and short-circuit without writing
    // any link.
    const warnSpy = vi.fn();
    const logSpy = vi.fn();
    await linkWorkItemRunFromLifecycleEvent(
      {
        logger: { warn: warnSpy, log: logSpy } as never,
        workItems: workItemRepository as never,
        workItemRunLeaseService: runLeaseService,
      },
      makeRunningEnvelope(),
    );

    // The projection logged a warning, did not link, and did not call
    // releaseRunLease (it never acquired).
    expect(workItemRepository.linkRunIfUnlinked).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      "Skipping lifecycle-projection link",
    );
    expect(warnSpy.mock.calls[0][0]).toContain(
      "kanban:work-item-run:project-1:work-item-1:dispatch",
    );
    // The active lease still belongs to the request holder — the
    // projection never released what it never acquired.
    const activeDuringHeld = await leaseRepo.listActiveByProject("project-1");
    expect(activeDuringHeld).toHaveLength(1);
    expect(activeDuringHeld[0].owner_id).toBe(
      "kanban:work-item-run:project-1:work-item-1:dispatch",
    );

    // Step 3: release the lease as if the in-flight requestWorkItemRun
    // call had completed. This is the boundary between the "lost poll"
    // and the "next poll" the production consumer advances to.
    await runLeaseService.releaseRunLease(
      "project-1",
      runLeaseService.deriveOwnerId("project-1", "work-item-1", "dispatch"),
    );

    // Step 4: the next projection attempt retries the link. The lease
    // is now free, so the projection acquires it, writes the link, and
    // releases the lease.
    await linkWorkItemRunFromLifecycleEvent(
      {
        logger: { warn: warnSpy, log: logSpy } as never,
        workItems: workItemRepository as never,
        workItemRunLeaseService: runLeaseService,
      },
      makeRunningEnvelope(),
    );

    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledTimes(1);
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: "run-f3",
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Linked work item work-item-1"),
    );
    // All leases are released after the retry succeeds.
    const activeAfterRetry = await leaseRepo.listActiveByProject("project-1");
    expect(activeAfterRetry).toHaveLength(0);

    // The work item's persisted state reflects the projection's link,
    // not a phantom state from the loser's earlier attempt.
    const stored = items.get("project-1:work-item-1");
    expect(stored?.linked_run_id).toBe("run-f3");
    expect(stored?.current_execution_id).toBe("run-f3");
  });

  // -------------------------------------------------------------------------
  // F6 — Partial writes when linkRunIfUnlinked returns false
  //
  // The dispatch action does not mutate status or metadata before the
  // link write. When a prior writer (crashed or reconciled) already
  // populated the link columns, the current call's linkRunIfUnlinked
  // returns false and surfaces a ConflictException *after* Core has
  // accepted the run. The orphan-status prevention invariant is that
  // the work item's status and metadata must equal the pre-call
  // snapshot — the dispatch action never touched them, and the failed
  // link must not have written a different linked_run_id.
  // -------------------------------------------------------------------------
  it("F6 — preserves the work item's status and metadata when linkRunIfUnlinked returns false (F6 partial-write window)", async () => {
    // Set up the work item in a pre-existing linked state. This is the
    // case where a previous call (or a reconciliation) populated the
    // link columns; the current dispatch call's conditional UPDATE
    // matches zero rows and returns false.
    addWorkItem({
      status: "in-review",
      metadata: { qa_decision: "approve" },
      linked_run_id: "run-prev",
      current_execution_id: "run-prev",
    });

    const before = items.get("project-1:work-item-1");
    const snapshot = {
      status: before?.status,
      metadata: before?.metadata,
      linked_run_id: before?.linked_run_id,
      current_execution_id: before?.current_execution_id,
    };

    await expect(
      service.dispatchWorkItem("project-1", "work-item-1", {
        workflowId: "dispatch-work-item-flow",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // The orphan-status prevention invariant: status and metadata must
    // be byte-equal to the pre-call snapshot. The dispatch action
    // never mutates either, so the snapshot must hold.
    const after = items.get("project-1:work-item-1");
    expect(after?.status).toBe(snapshot.status);
    expect(after?.metadata).toEqual(snapshot.metadata);
    // The link columns must still reference the prior run, not the
    // current call's accepted run — the failed link must not have
    // overwritten the work item's persisted state with a phantom value.
    expect(after?.linked_run_id).toBe(snapshot.linked_run_id);
    expect(after?.current_execution_id).toBe(snapshot.current_execution_id);
    expect(after?.linked_run_id).not.toBe("run-1");

    // The lease was acquired and released cleanly — there is no
    // leaked lease row from this failed attempt.
    const active = await leaseRepo.listActiveByProject("project-1");
    expect(active).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Rollback — work_item_run_lease_enabled = false
  //
  // The ADR-20260623 rollback flag short-circuits the per-work-item
  // lease acquire/release and falls back to the pre-ADR conditional
  // `linkRunIfUnlinked` UPDATE only. This test pins the contract:
  //   1. With the flag off, `acquireRunLease` and `releaseRunLease` on
  //      the lease service are not called.
  //   2. The work item still gets linked to the run id (the conditional
  //      UPDATE is the race-safety barrier on the rollback path).
  //   3. No lease row is written to the lease repository.
  //
  // See apps/kanban/README.md#race-safe-work-item-run-linking and the
  // runbook at docs/operations/README.md#work-item-run-link-lease-contention
  // for the operational trigger and verification.
  // -------------------------------------------------------------------------
  it("rollback — work_item_run_lease_enabled = false skips lease acquire and release", async () => {
    addWorkItem();

    const acquireSpy = vi.spyOn(runLeaseService, "acquireRunLease");
    const releaseSpy = vi.spyOn(runLeaseService, "releaseRunLease");

    // Rebuild the service with the rollback flag explicitly disabled.
    const rollbackService = buildService(undefined, {
      getBoolean: (key: string) =>
        Promise.resolve(key === "work_item_run_lease_enabled" ? false : false),
    });

    const result = await rollbackService.dispatchWorkItem(
      "project-1",
      "work-item-1",
      { workflowId: "dispatch-work-item-flow" },
    );

    expect(result.run_id).toBe("run-1");
    // The flag was honoured: neither acquire nor release is invoked.
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    // The conditional link still wrote the run id and the invariant
    // (linked_run_id === current_execution_id) still holds.
    const stored = items.get("project-1:work-item-1");
    expect(stored?.linked_run_id).toBe("run-1");
    expect(stored?.current_execution_id).toBe("run-1");
    // No lease row was ever written — the rollback path does not
    // touch the lease table.
    const active = await leaseRepo.listActiveByProject("project-1");
    expect(active).toHaveLength(0);
  });
});
