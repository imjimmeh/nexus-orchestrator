import { CanActivate, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BaseRequestContextService,
  type WorkflowRunStatusV1,
} from "@nexus/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreWorkflowClientService } from "../src/core/core-workflow-client.service";
import { KanbanPermissionsGuard } from "../src/common/kanban-permissions.guard";
import { DispatchService } from "../src/dispatch/dispatch.service";
import { isOrphanedInProgressItem } from "../src/dispatch/orphan-work-item-reconciliation";
import { KanbanOrchestrationLeaseRepository } from "../src/database/repositories/kanban-orchestration-lease.repository";
import { KanbanLifecycleEventPublisher } from "../src/work-item/kanban-lifecycle-event-publisher";
import { WorkItemController } from "../src/work-item/work-item.controller";
import { WorkItemRunLeaseService } from "../src/work-item/work-item-run-lease";
import { WorkItemService } from "../src/work-item/work-item.service";
import { KanbanProjectRepository } from "../src/database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../src/database/repositories/kanban-work-item.repository";
import { KanbanWorkItemRunCostRepository } from "../src/database/repositories/kanban-work-item-run-cost.repository";
import { OrchestrationLeaseService } from "../src/orchestration/control-plane/orchestration-lease.service";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "../src/orchestration/control-plane/control-plane.types";
import { ProjectService } from "../src/project/project.service";
import { KanbanSettingsService } from "../src/settings/kanban-settings.service";
import { WorkItemRealtimeGateway } from "../src/work-item/work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "../src/work-item/work-item-realtime.publisher";
import { WorkItemCostEstimationService } from "../src/work-item/cost-estimation/work-item-cost-estimation.service";

const allowAllGuard: CanActivate = { canActivate: () => true };

// ---------------------------------------------------------------------------
// Stored work item shape (mirrors KanbanWorkItemEntity columns touched by
// the race-condition tests). The integration spec stores work items in a
// plain Map and overrides the relevant KanbanWorkItemRepository methods;
// this keeps the test free of a Postgres dependency.
// ---------------------------------------------------------------------------
type StoredWorkItem = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  scope: string;
  description: string | null;
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

function makeWorkItem(overrides: Partial<StoredWorkItem> = {}): StoredWorkItem {
  const now = new Date("2026-06-23T00:00:00.000Z");
  return {
    id: "wi-race",
    project_id: "project-1",
    title: "Race target",
    status: "todo",
    priority: "p2",
    scope: "standard",
    description: null,
    assigned_agent_id: null,
    token_spend: 0,
    current_execution_id: null,
    waiting_for_input: false,
    execution_config: null,
    metadata: null,
    linked_run_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryOrchestrationLeaseRepository
//
// Mirrors the production lease repository contract in pure JS. The
// `acquire` method runs the same lazy-reclaim-then-insert sequence as
// the TypeORM-backed repository, so the WorkItemRunLeaseService and
// OrchestrationLeaseService code paths exercise the production contract
// end-to-end without requiring Postgres.
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

describe("Work item run-link race integration", () => {
  let app: INestApplication;
  let store: Map<string, StoredWorkItem>;
  let leaseRepo: InMemoryOrchestrationLeaseRepository;
  let leaseService: OrchestrationLeaseService;
  let workItemRunLeaseService: WorkItemRunLeaseService;
  let workItemRepository: ReturnType<typeof createWorkItemRepository>;
  let requestWorkflowRun: ReturnType<
    typeof vi.fn<
      (request: { workflow_id: string }) => Promise<{
        run_id: string;
        workflow_id: string;
      }>
    >
  >;
  let getWorkflowRunStatus: ReturnType<
    typeof vi.fn<(runId: string) => Promise<WorkflowRunStatusV1>>
  >;
  let dispatchService: DispatchService;

  function createWorkItemRepository() {
    return {
      findByProjectAndId: vi.fn((project_id: string, id: string) => {
        const item = store.get(id);
        return Promise.resolve(item?.project_id === project_id ? item : null);
      }),
      save: vi.fn((input: StoredWorkItem) => {
        const existing = store.get(input.id);
        const now = new Date("2026-06-23T00:01:00.000Z");
        const saved: StoredWorkItem = {
          ...existing,
          ...input,
          updated_at: now,
        };
        store.set(saved.id, saved);
        return Promise.resolve(saved);
      }),
      findByproject_id: vi.fn((project_id: string) =>
        Promise.resolve(
          Array.from(store.values()).filter(
            (item) => item.project_id === project_id,
          ),
        ),
      ),
      findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
      findSubtasksByWorkItemIds: vi.fn(() => Promise.resolve([])),
      // The conditional link mirrors the production
      // `linkRunIfUnlinked` semantics: the caller succeeds only if the
      // link columns are currently null, so concurrent calls cannot
      // both observe an empty link and both insert a different value.
      linkRunIfUnlinked: vi.fn(
        (params: { project_id: string; workItemId: string; runId: string }) => {
          const item = store.get(params.workItemId);
          if (!item || item.project_id !== params.project_id) {
            return Promise.resolve(false);
          }
          if (
            item.linked_run_id !== null ||
            item.current_execution_id !== null
          ) {
            return Promise.resolve(false);
          }
          const linked: StoredWorkItem = {
            ...item,
            linked_run_id: params.runId,
            current_execution_id: params.runId,
          };
          store.set(linked.id, linked);
          return Promise.resolve(true);
        },
      ),
      // The pessimistic_write row-lock re-read; the lease-protected
      // helper asserts the post-link invariant here.
      findByProjectAndIdForUpdate: vi.fn(
        (project_id: string, workItemId: string) => {
          const item = store.get(workItemId);
          return Promise.resolve(item?.project_id === project_id ? item : null);
        },
      ),
      // This fixture's StoredWorkItem has no `type`/children model — none
      // of these race fixtures are containers, so the dispatch guard in
      // `requestWorkItemRun` always sees an empty children set.
      existsChildrenFor: vi.fn(() => Promise.resolve(new Set<string>())),
      clearRunLinksIfMatches: vi.fn(
        (project_id: string, workItemId: string, runId: string) => {
          const item = store.get(workItemId);
          if (!item || item.project_id !== project_id)
            return Promise.resolve(false);
          if (
            item.linked_run_id !== runId ||
            (item.current_execution_id !== null &&
              item.current_execution_id !== runId)
          ) {
            return Promise.resolve(false);
          }
          const cleared: StoredWorkItem = {
            ...item,
            linked_run_id: null,
            current_execution_id: null,
          };
          store.set(cleared.id, cleared);
          return Promise.resolve(true);
        },
      ),
    };
  }

  beforeEach(async () => {
    nextLeaseSeq = 0;
    store = new Map([["wi-race", makeWorkItem({ status: "todo" })]]);
    leaseRepo = new InMemoryOrchestrationLeaseRepository();
    leaseService = new OrchestrationLeaseService(leaseRepo as never);
    workItemRunLeaseService = new WorkItemRunLeaseService(leaseService);

    requestWorkflowRun = vi.fn(
      (req: {
        workflow_id: string;
      }): Promise<{ run_id: string; workflow_id: string }> => {
        // Each successful accept mints a fresh run id so the assertions
        // can pin the winner's run id without ambiguity. The loser's
        // call is short-circuited at the lease step and never reaches
        // Core, so requestWorkflowRun fires only once.
        return Promise.resolve({
          run_id: `run-${requestWorkflowRun.mock.calls.length}`,
          workflow_id: req.workflow_id,
        });
      },
    );

    // The reconciliation tests assert that reconcileLinkedRuns still
    // classifies the winner's link as terminal-eligible; the run status
    // here is set to RUNNING so the reconciliation leaves the link
    // alone (no false-positive cleared link on a healthy dispatch).
    getWorkflowRunStatus = vi.fn(
      (runId: string): Promise<WorkflowRunStatusV1> => {
        const item = Array.from(store.values()).find(
          (candidate) => candidate.linked_run_id === runId,
        );
        return Promise.resolve({
          run_id: runId,
          workflow_id: "dispatch-work-item-flow",
          status: "RUNNING",
          updated_at: new Date("2026-06-23T00:01:00.000Z").toISOString(),
          metadata: { correlation_id: "corr-race-int" },
          ...(item
            ? { context: { scopeId: item.project_id, contextId: item.id } }
            : {}),
        });
      },
    );

    workItemRepository = createWorkItemRepository();

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkItemController],
      providers: [
        WorkItemService,
        { provide: KanbanWorkItemRepository, useValue: workItemRepository },
        {
          provide: KanbanProjectRepository,
          useValue: {
            findById: vi.fn().mockResolvedValue({
              id: "project-1",
              repository_workflow_settings: { enabled: false },
            }),
          },
        },
        {
          provide: CoreWorkflowClientService,
          useValue: { requestWorkflowRun, getWorkflowRunStatus },
        },
        {
          provide: BaseRequestContextService,
          useValue: {
            getRequestId: () => "req-race",
            getCausationId: () => "cause-race",
          },
        },
        {
          provide: KanbanLifecycleEventPublisher,
          useValue: {
            emitStatusChanged: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: WorkItemRealtimePublisher,
          useValue: { publish: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WorkItemRealtimeGateway,
          useValue: { broadcastWorkItemUpdated: vi.fn() },
        },
        {
          provide: WorkItemCostEstimationService,
          useValue: { estimate: vi.fn() },
        },
        {
          provide: KanbanWorkItemRunCostRepository,
          useValue: { findAllForBucketAggregation: vi.fn() },
        },
        WorkItemRunLeaseService,
        {
          provide: OrchestrationLeaseService,
          useValue: leaseService,
        },
        {
          provide: KanbanOrchestrationLeaseRepository,
          useValue: leaseRepo,
        },
        // DispatchService is wired so the integration spec can verify
        // reconcileProjectLinkedRuns classifies the race winner's link
        // correctly after the concurrent dispatches have settled.
        DispatchService,
        {
          provide: KanbanSettingsService,
          useValue: {
            getNumber: vi.fn().mockResolvedValue(100),
            // Lease rollback flag enabled (default). The flag is
            // read by requestWorkItemRun via `getBoolean`; the
            // default value `work_item_run_lease_enabled = true`
            // keeps the per-work-item lease in front of every
            // request call (see
            // docs/operations/README.md#work-item-run-link-lease-contention
            // for the rollback runbook).
            getBoolean: vi.fn((key: string) =>
              Promise.resolve(key === "work_item_run_lease_enabled"),
            ),
            get: vi.fn(),
            getAll: vi.fn(),
            set: vi.fn(),
            seedDefaults: vi.fn(),
            onModuleInit: vi.fn(),
          },
        },
        {
          provide: ProjectService,
          useValue: { get: vi.fn().mockResolvedValue(null) },
        },
      ],
    })
      .overrideGuard(KanbanPermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dispatchService = moduleRef.get(DispatchService);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  /**
   * Drive two concurrent POST /work-items/:id/dispatch calls through
   * the full WorkItemService + WorkItemRunLeaseService stack and wait
   * for the race to settle at the lease step. The first request's
   * Core call is deferred until the test releases it via the returned
   * resolver, so the second request is forced to fail at the lease
   * acquire step (not at the link step).
   */
  async function dispatchTwoConcurrent(): Promise<{
    responses: Array<
      | { kind: "fulfilled"; value: request.Response }
      | { kind: "rejected"; reason: unknown }
    >;
  }> {
    const dispatchBody = {
      workflow_id: "dispatch-work-item-flow",
      requested_by: "race-tester",
    };

    let resolveCoreAccept: (runId: string) => void = () => undefined;
    const firstCoreCallPromise = new Promise<string>((resolve) => {
      resolveCoreAccept = resolve;
    });
    requestWorkflowRun.mockImplementationOnce((req: { workflow_id: string }) =>
      firstCoreCallPromise.then((runId) => ({
        run_id: runId,
        workflow_id: req.workflow_id,
      })),
    );

    // supertest / superagent only sends the HTTP request when `.then()`
    // is invoked. Trigger both requests with `.then(...)` *before*
    // awaiting so they are in-flight on the test server concurrently
    // rather than serialised by Node's microtask queue.
    const triggerRequest = (): Promise<
      | { kind: "fulfilled"; value: request.Response }
      | { kind: "rejected"; reason: unknown }
    > =>
      request(app.getHttpServer())
        .post("/projects/project-1/work-items/wi-race/dispatch")
        .send(dispatchBody)
        .then(
          (response) => ({ kind: "fulfilled" as const, value: response }),
          (reason: unknown) => ({ kind: "rejected" as const, reason }),
        );
    const firstRequest = triggerRequest();
    const secondRequest = triggerRequest();

    // Poll until the first request reaches the lease-acquire step AND
    // the second request has attempted acquisition (which will return
    // acquired: false because the lease is held). The polling loop
    // gives the second request a short grace period to make its
    // acquire attempt and surface as a 409 before we resolve the
    // first request's Core call.
    const waitForRaceSettled = async () => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const active = await leaseRepo.listActiveByProject("project-1");
        if (active.length === 1) {
          // The first request holds the lease. Give the second
          // request time to attempt acquisition and surface its 409.
          await new Promise((resolve) => setTimeout(resolve, 50));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("first request never acquired the lease");
    };
    await waitForRaceSettled();
    resolveCoreAccept("run-1");

    const responses = await Promise.all([firstRequest, secondRequest]);
    return { responses };
  }

  it("two concurrent POST /work-items/:id/dispatch calls: exactly one run id wins, the loser surfaces a 409 conflict", async () => {
    // Two concurrent dispatches against the same work item through the
    // full WorkItemService + WorkItemRunLeaseService stack. The
    // per-work-item lease closes the F1 window: only one caller wins
    // the lease, the other receives a deterministic 409 conflict
    // *before* any DB read or coreClient.requestWorkflowRun call.
    //
    // The fake Core client returns a deferred promise on the *first*
    // call so the test can interleave the second request while the
    // first request is paused at the requestWorkflowRun await point.
    // Without the deferred, Node.js's single-threaded scheduler would
    // run the first request to completion (releasing the lease)
    // before the second request started, and the second request
    // would see the link columns already populated rather than
    // failing at the lease acquire step.
    const { responses } = await dispatchTwoConcurrent();

    const fulfilled = responses.filter(
      (outcome): outcome is { kind: "fulfilled"; value: request.Response } =>
        outcome.kind === "fulfilled",
    );
    const rejected = responses.filter(
      (outcome): outcome is { kind: "rejected"; reason: unknown } =>
        outcome.kind === "rejected",
    );

    // Both HTTP calls completed (no client-side rejections); the
    // server returned one 2xx and one 409.
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);

    const statusByResponse = fulfilled.map((outcome) => outcome.value.status);
    expect(statusByResponse.filter((status) => status === 201)).toHaveLength(1);
    expect(statusByResponse.filter((status) => status === 409)).toHaveLength(1);

    const winnerOutcome = fulfilled.find(
      (outcome) => outcome.value.status === 201,
    );
    const loserOutcome = fulfilled.find(
      (outcome) => outcome.value.status === 409,
    );
    if (!winnerOutcome || !loserOutcome) {
      throw new Error(
        "expected exactly one 201 winner and one 409 loser response",
      );
    }
    const winnerResponse = winnerOutcome.value;
    const loserResponse = loserOutcome.value;

    // The winner body carries the accepted run id and a fully
    // populated workItem record with linkedRunId set.
    const winnerBody = winnerResponse.body as {
      success: boolean;
      data: { run_id: string; workItem: { linkedRunId: string | null } };
    };
    expect(winnerBody.success).toBe(true);
    expect(winnerBody.data.run_id).toBe("run-1");

    // The loser body carries a NestJS 409 envelope with a ConflictException
    // message describing the lease-held reason.
    const loserBody = loserResponse.body as {
      message: string | string[];
      statusCode: number;
    };
    expect(loserBody.statusCode).toBe(409);
    const loserMessage = Array.isArray(loserBody.message)
      ? loserBody.message.join(" ")
      : loserBody.message;
    expect(loserMessage).toMatch(/already being launched/i);

    // Post-call kanban_work_items state: exactly one linked_run_id
    // pointing at the winner's run, and the work item is in a
    // deterministic, persisted state.
    const stored = store.get("wi-race");
    expect(stored?.linked_run_id).toBe(winnerBody.data.run_id);
    expect(stored?.current_execution_id).toBe(winnerBody.data.run_id);
    // Exactly one workflow-run request was issued — the lease prevented
    // the loser from invoking Core.
    expect(requestWorkflowRun).toHaveBeenCalledTimes(1);
    // Exactly one link write happened — the conditional
    // linkRunIfUnlinked path was reached once for the winner.
    expect(workItemRepository.linkRunIfUnlinked).toHaveBeenCalledTimes(1);
  });

  it("the reconciliation paths still classify the race winner's link correctly after the race settles", async () => {
    // Step 1: drive the concurrent dispatch race exactly as the
    // first test does, but here we only need the post-call state. We
    // use the same deferred-promise interleaving as the first test
    // so the second request is denied at the lease step (not at the
    // link step).
    const { responses } = await dispatchTwoConcurrent();

    const fulfilled = responses.filter(
      (outcome): outcome is { kind: "fulfilled"; value: request.Response } =>
        outcome.kind === "fulfilled",
    );
    expect(fulfilled.map((r) => r.value.status).sort()).toEqual([201, 409]);

    // The winner's stored state: linked_run_id is set, current_execution_id
    // is set, and the link columns agree.
    const stored = store.get("wi-race");
    expect(stored?.linked_run_id).not.toBeNull();
    expect(stored?.current_execution_id).toBe(stored?.linked_run_id);

    // The orphan-reconciliation helper (which reconcileOrphanedItems
    // uses to classify items as orphaned in-progress) must NOT classify
    // the winner as orphaned: the winner has a linked_run_id and a
    // current_execution_id, so isOrphanedInProgressItem returns false.
    expect(
      isOrphanedInProgressItem({
        status: stored?.status ?? "todo",
        linked_run_id: stored?.linked_run_id ?? null,
        current_execution_id: stored?.current_execution_id ?? null,
      }),
    ).toBe(false);

    // DispatchService.reconcileProjectLinkedRuns is the public wrapper
    // around reconcileLinkedRuns + reconcileOrphanedItems. The winner's
    // run is RUNNING in our core status fake, so reconcileLinkedRuns
    // must NOT clear the link (RUNNING is not in TERMINAL_RUN_STATUSES).
    const summary =
      await dispatchService.reconcileProjectLinkedRuns("project-1");
    expect(summary.reconciled).toEqual([]);
    expect(summary.orphanReconciled).toEqual([]);

    const afterReconcile = store.get("wi-race");
    // The link survives reconciliation because the run is RUNNING.
    expect(afterReconcile?.linked_run_id).toBe(stored?.linked_run_id);
    expect(afterReconcile?.current_execution_id).toBe(
      stored?.current_execution_id,
    );
  });

  it("the reconciliation paths still classify a non-orphan (non-race) work item correctly (regression)", async () => {
    // Regression guard for the reconciliation helper: a work item that
    // was never dispatched (status=todo, no link) must NOT be touched
    // by reconcileProjectLinkedRuns, because it is not in any
    // reconciliation scope (no linked_run_id) and not orphaned (not
    // in-progress).
    const summary =
      await dispatchService.reconcileProjectLinkedRuns("project-1");
    expect(summary.reconciled).toEqual([]);
    expect(summary.orphanReconciled).toEqual([]);
    expect(summary.skipped).toEqual([]);

    // The work item is untouched.
    const stored = store.get("wi-race");
    expect(stored?.status).toBe("todo");
    expect(stored?.linked_run_id).toBeNull();
    expect(stored?.current_execution_id).toBeNull();

    // No lease rows are leaked from a no-op reconciliation.
    const activeLeases = await leaseRepo.listActiveByProject("project-1");
    expect(activeLeases).toHaveLength(0);
  });
});
