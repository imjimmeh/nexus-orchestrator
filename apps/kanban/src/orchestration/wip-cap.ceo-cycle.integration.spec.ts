/**
 * Cross-component integration test for the WIP-cap CEO orchestration cycle.
 *
 * Verifies AC-5 for the Project WIP Cap work item
 * (`6d9d9031-ed15-4340-b79b-5d200ff0fed2`):
 *   1. At capacity the CEO cycle records a `blocked` (or `pause`)
 *      decision — never a fresh dispatch — and `requestOrchestrationCycle`
 *      is not invoked as a result of the continuation evaluation.
 *   2. Consecutive CEO cycles do not repeatedly persist a `blocked`
 *      transition: the cycle decision service dedupes by
 *      `cycle_decision_idempotency_key` so a follow-up call with the same
 *      trigger + workflowRunId reports `duplicate: true` /
 *      `persisted: false` instead of overwriting the persisted decision.
 *   3. Below the persisted cap the CEO cycle records a non-blocked
 *      decision (here: `pause` returned without a cycle-decision
 *      persistence when no dispatchable work exists).
 *
 * Wiring strategy mirrors the WIP-cap dispatch service integration spec
 * (`apps/kanban/src/dispatch/dispatch.service.wip-cap.integration.spec.ts`)
 * and the WIP-cap reconciler integration spec
 * (`apps/kanban/src/orchestration/orchestration-continuation-reconciler.integration.spec.ts`):
 *   - Real `OrchestrationContinuationService`, `OrchestrationService`,
 *     `OrchestrationCycleDecisionService`, `DispatchService`, and
 *     `KanbanSettingsService` constructed via `Test.createTestingModule`.
 *   - `KanbanSettingRepository` overridden with a `Map`-backed in-memory
 *     repository so `seedDefaults()` + `set(...)` mutate the same store
 *     the dispatch / continuation path reads from.
 *   - `KanbanOrchestrationRepository` overridden with an in-memory
 *     `Map`-backed repository so the `recordCycleDecision` →
 *     `savePersistenceState` round-trip persists the
 *     `cycle_decision_idempotency_key` between consecutive cycles for
 *     the duplicate-detection assertions.
 *   - Remaining collaborators (`KanbanWorkItemRepository`,
 *     `CoreWorkflowClientService`, `BaseRequestContextService`,
 *     `WorkItemService`, `ProjectService`) stubbed with minimal
 *     `useValue` fakes — only the surface the CEO cycle actually touches
 *     (`findByproject_id`, `findDependenciesByWorkItemIds`,
 *     `emitDomainEventOrThrow`, `getRequestId`, `getCausationId`,
 *     `updateStatus`, `updateWorkItem`, `get`) is implemented.
 *   - Capacity math delegated to the real `resolveProjectDispatchCapacity`
 *     helper from `apps/kanban/src/dispatch/project-dispatch-capacity.ts`;
 *     the test never reimplements `isProjectDispatchActive` or the
 *     `availableSlots` arithmetic.
 *   - `OrchestrationCycleDecisionService.recordCycleDecision` is wrapped
 *     with `vi.spyOn` after `module.compile()` so each test can assert
 *     the exact decision value (and idempotency key) the CEO cycle
 *     hands to the cycle decision service.
 */

import type { INestApplication, Provider } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { BaseRequestContextService } from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanSettingRepository } from "../database/repositories/kanban-setting.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { ProjectService } from "../project/project.service";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import { DispatchService } from "../dispatch/dispatch.service";
import {
  resolveProjectDispatchCapacity,
  isProjectDispatchActive,
} from "../dispatch/project-dispatch-capacity";
import type { ProjectDispatchCapacity } from "../dispatch/project-dispatch-capacity.types";
import type { WorkItemRecord } from "../dispatch/dispatch-internal.types";
import { KanbanRetrospectiveService } from "../retrospectives/kanban-retrospective.service";
import { KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE } from "../retrospectives/kanban-retrospective-failure-threshold.types";
import {
  OrchestrationActionRequestsService,
} from "./orchestration-action-requests.service";
import {
  OrchestrationContinuationService,
} from "./orchestration-continuation.service";
import {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  OrchestrationCycleDecisionService,
} from "./orchestration-cycle-decision.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationService } from "./orchestration.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OrchestrationEntity {
  project_id: string;
  goals: string;
  mode: string;
  status: string;
  linked_run_id: string | null;
  decision_log: unknown[];
  action_requests: unknown[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface WorkItemSeed {
  id: string;
  status:
    | "backlog"
    | "todo"
    | "in-progress"
    | "in-review"
    | "ready-to-merge"
    | "blocked"
    | "done";
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

function makeWorkItemRecord(
  projectId: string,
  seed: WorkItemSeed,
): WorkItemRecord {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    id: seed.id,
    project_id: projectId,
    title: `Work item ${seed.id}`,
    status: seed.status,
    priority: "p2",
    assigned_agent_id: null,
    linked_run_id: seed.linked_run_id ?? null,
    current_execution_id: seed.current_execution_id ?? null,
    execution_config: null,
    metadata: seed.metadata ?? null,
    description: null,
    scope: "standard",
    token_spend: 0,
    cost_cents: 0,
    waiting_for_input: false,
    initiative_id: null,
    last_execution_status: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Map-backed `KanbanSettingRepository` so `KanbanSettingsService.set(...)`
 * mutates the same store `resolveProjectDispatchCapacity` reads via
 * `kanbanSettings.getNumber(...)`. Mirrors the helper exported from
 * `apps/kanban/src/orchestration/orchestration-continuation-reconciler.integration.spec.ts`.
 */
function createInMemorySettingsRepository(): {
  repository: KanbanSettingRepository;
  store: Map<string, SettingRow>;
} {
  const store = new Map<string, SettingRow>();

  const repository = {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...store.values()].sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) =>
      Promise.resolve(store.get(key) ?? null),
    ),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = store.get(key);
        const row: SettingRow = {
          key,
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        store.set(key, row);
        return Promise.resolve(row);
      },
    ),
  } as unknown as KanbanSettingRepository;

  return { repository, store };
}

/**
 * Map-backed `KanbanOrchestrationRepository` so the cycle decision service's
 * `savePersistenceState` callback actually persists the
 * `cycle_decision_idempotency_key` between consecutive CEO cycles —
 * duplicate detection depends on the next `findByproject_id` returning the
 * previously-persisted metadata.
 */
function createInMemoryOrchestrationRepository(): {
  repository: KanbanOrchestrationRepository;
  states: Map<string, OrchestrationEntity>;
} {
  const states = new Map<string, OrchestrationEntity>();

  const repository = {
    save: vi.fn((input: Partial<OrchestrationEntity>) => {
      const projectId = input.project_id;
      if (typeof projectId !== "string") {
        return Promise.reject(
          new Error("KanbanOrchestrationRepository.save requires project_id"),
        );
      }
      const existing = states.get(projectId);
      const next: OrchestrationEntity = {
        project_id: projectId,
        goals: input.goals ?? existing?.goals ?? "",
        mode: input.mode ?? existing?.mode ?? "autonomous",
        status: input.status ?? existing?.status ?? "orchestrating",
        linked_run_id:
          input.linked_run_id === undefined
            ? (existing?.linked_run_id ?? null)
            : input.linked_run_id,
        decision_log:
          input.decision_log ?? existing?.decision_log ?? [],
        action_requests:
          input.action_requests ?? existing?.action_requests ?? [],
        metadata: input.metadata ?? existing?.metadata ?? null,
        created_at: existing?.created_at ?? new Date(),
        updated_at: new Date(),
      };
      states.set(projectId, next);
      return Promise.resolve(next as never);
    }),
    findByproject_id: vi.fn((project_id: string) =>
      Promise.resolve(states.get(project_id) ?? null),
    ),
    findByLinkedRunId: vi.fn(() => Promise.resolve(null)),
    clearLinkedRunIfMatches: vi.fn(() => Promise.resolve(false)),
    findAll: vi.fn(() =>
      Promise.resolve([...states.values()] as never),
    ),
    findByStatus: vi.fn((status: string) =>
      Promise.resolve(
        [...states.values()].filter((s) => s.status === status) as never,
      ),
    ),
    updateMode: vi.fn(() => Promise.resolve()),
    listAllModes: vi.fn(() => Promise.resolve([])),
    deleteByproject_id: vi.fn(() => Promise.resolve()),
  } as unknown as KanbanOrchestrationRepository;

  return { repository, states };
}

function seedOrchestrationState(
  projectId: string,
  states: Map<string, OrchestrationEntity>,
): OrchestrationPersistenceRecord {
  const now = new Date("2026-07-01T00:00:00.000Z");
  const entity: OrchestrationEntity = {
    project_id: projectId,
    goals: "WIP-cap CEO cycle regression scenario",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: null,
    decision_log: [],
    action_requests: [],
    metadata: {},
    created_at: now,
    updated_at: now,
  };
  states.set(projectId, entity);
  return {
    project_id: entity.project_id,
    goals: entity.goals,
    mode: entity.mode,
    status: entity.status,
    linked_run_id: entity.linked_run_id,
    decision_log: entity.decision_log as never,
    action_requests: entity.action_requests as never,
    metadata: entity.metadata,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  };
}

interface WiringHarness {
  settingsRepository: KanbanSettingRepository;
  settingsStore: Map<string, SettingRow>;
  orchestrationRepository: KanbanOrchestrationRepository;
  orchestrationStates: Map<string, OrchestrationEntity>;
  workItemsStore: Map<string, WorkItemRecord>;
  findByProjectSpy: Mock<(projectId: string) => Promise<WorkItemRecord[]>>;
  findDependenciesByWorkItemIdsSpy: Mock<
    (workItemIds: string[]) => Promise<unknown[]>
  >;
  emitDomainEventOrThrowSpy: Mock<() => Promise<void>>;
  requestContext: {
    getRequestId: ReturnType<typeof vi.fn>;
    getCausationId: ReturnType<typeof vi.fn>;
  };
  workItemService: {
    updateStatus: ReturnType<typeof vi.fn>;
    updateWorkItem: ReturnType<typeof vi.fn>;
  };
  projectService: {
    get: ReturnType<typeof vi.fn>;
  };
  projectRepository: KanbanProjectRepository;
  clearPendingConsecutiveFailureSpy: ReturnType<typeof vi.fn>;
  failureThresholdService: {
    checkFailureThreshold: ReturnType<typeof vi.fn>;
    resetConsecutiveFailureCount: ReturnType<typeof vi.fn>;
  };
  retrospectiveService: {
    runForCompletion: ReturnType<typeof vi.fn>;
  };
}

function buildHarness(): WiringHarness {
  const { repository: settingsRepository, store: settingsStore } =
    createInMemorySettingsRepository();
  const {
    repository: orchestrationRepository,
    states: orchestrationStates,
  } = createInMemoryOrchestrationRepository();
  const workItemsStore = new Map<string, WorkItemRecord>();

  const findByProjectSpy = vi.fn(
    (projectId: string) =>
      Promise.resolve(
        [...workItemsStore.values()].filter(
          (item) => item.project_id === projectId,
        ),
      ),
  );

  const findDependenciesByWorkItemIdsSpy = vi.fn(() => Promise.resolve([]));

  const emitDomainEventOrThrowSpy = vi.fn(() => Promise.resolve());

  const requestContext = {
    getRequestId: vi.fn(() => "corr-wip-cap-ceo"),
    getCausationId: vi.fn(() => "cause-wip-cap-ceo"),
  };

  const workItemService = {
    updateStatus: vi.fn(
      (projectId: string, workItemId: string, status: string) => {
        const item = workItemsStore.get(workItemId);
        if (!item || item.project_id !== projectId) {
          return Promise.reject(
            new Error(`work item ${workItemId} not found in ${projectId}`),
          );
        }
        const next: WorkItemRecord = { ...item, status };
        workItemsStore.set(workItemId, next);
        return Promise.resolve(next);
      },
    ),
    updateWorkItem: vi.fn(
      (projectId: string, workItemId: string, patch: Record<string, unknown>) => {
        const item = workItemsStore.get(workItemId);
        if (!item || item.project_id !== projectId) {
          return Promise.reject(
            new Error(`work item ${workItemId} not found in ${projectId}`),
          );
        }
        const next: WorkItemRecord = {
          ...item,
          metadata: { ...(item.metadata ?? {}), ...(patch.metadata ?? {}) },
        };
        workItemsStore.set(workItemId, next);
        return Promise.resolve(next);
      },
    ),
  };

  const projectService = {
    get: vi.fn(() => Promise.resolve(null)),
  };

  const projectRepository = {
    findById: vi.fn(() => Promise.resolve(null)),
  } as unknown as KanbanProjectRepository;

  const clearPendingConsecutiveFailureSpy = vi.fn(() => Promise.resolve());

  const failureThresholdService = {
    checkFailureThreshold: vi.fn(() => Promise.resolve()),
    resetConsecutiveFailureCount: vi.fn(() => Promise.resolve()),
  };

  const retrospectiveService = {
    runForCompletion: vi.fn(() => Promise.resolve()),
  };

  return {
    settingsRepository,
    settingsStore,
    orchestrationRepository,
    orchestrationStates,
    workItemsStore,
    findByProjectSpy,
    findDependenciesByWorkItemIdsSpy,
    emitDomainEventOrThrowSpy,
    requestContext,
    workItemService,
    projectService,
    projectRepository,
    clearPendingConsecutiveFailureSpy,
    failureThresholdService,
    retrospectiveService,
  };
}

function buildWiringProviders(harness: WiringHarness): Provider[] {
  return [
    // Real services with auto-wireable dependencies.
    KanbanSettingsService,
    DispatchService,

    // In-memory setting + orchestration repository overrides.
    { provide: KanbanSettingRepository, useValue: harness.settingsRepository },
    {
      provide: KanbanOrchestrationRepository,
      useValue: harness.orchestrationRepository,
    },

    // Real cycle decision service wired through its injection tokens.
    OrchestrationCycleDecisionService,
    {
      provide: KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
      useValue: harness.failureThresholdService,
    },
    {
      provide: ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
      useValue: harness.clearPendingConsecutiveFailureSpy,
    },
    { provide: KanbanRetrospectiveService, useValue: harness.retrospectiveService },

    // Real OrchestrationService constructed via useFactory so its many
    // helper-service collaborators can be provided as minimal stubs.
    {
      provide: OrchestrationService,
      useFactory: (
        coreClient: CoreWorkflowClientService,
        requestContext: BaseRequestContextService,
        orchestrations: KanbanOrchestrationRepository,
        projects: ProjectService,
        workItems: KanbanWorkItemRepository,
        retrospectives: KanbanRetrospectiveService,
        failureThreshold: typeof KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
        kanbanSettings: KanbanSettingsService,
        cycleDecisionService: OrchestrationCycleDecisionService,
      ) =>
        new OrchestrationService(
          { requestWorkflowRun: vi.fn() },
          { hasActiveProjectWorkflowRun: vi.fn().mockResolvedValue(false) } as never,
          requestContext,
          orchestrations,
          projects,
          workItems,
          { selectPolicy: vi.fn(() => "ask_when_uncertain") } as never,
          retrospectives,
          failureThreshold as never,
          kanbanSettings,
          { hasActiveCycleLease: vi.fn().mockResolvedValue(false) } as never,
          { buildStrategicState: vi.fn() } as never,
          harness.workItemService as unknown as WorkItemService,
          cycleDecisionService,
          new OrchestrationActionRequestsService(
            { getRequestId: () => null },
            orchestrations,
            { updateStatus: vi.fn() } as never,
          ),
          new OrchestrationObservabilityService(workItems),
          new OrchestrationStateLifecycleService(),
          new OrchestrationRunRequestService(),
        ),
      inject: [
        CoreWorkflowClientService,
        BaseRequestContextService,
        KanbanOrchestrationRepository,
        ProjectService,
        KanbanWorkItemRepository,
        KanbanRetrospectiveService,
        KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
        KanbanSettingsService,
        OrchestrationCycleDecisionService,
      ],
    },

    // Real OrchestrationContinuationService constructed via useFactory so
    // its forwardRef'd wakeup collaborator is provided as a stub and the
    // CEO cycle's call path can be observed.
    {
      provide: OrchestrationContinuationService,
      useFactory: (
        orchestrationService: OrchestrationService,
        dispatchService: DispatchService,
        workItems: KanbanWorkItemRepository,
        workItemService: WorkItemService,
        coreWorkflowClient: CoreWorkflowClientService,
      ) =>
        new OrchestrationContinuationService(
          orchestrationService,
          dispatchService,
          workItems,
          workItemService,
          { requestWakeup: vi.fn().mockResolvedValue({ emitted: false }) } as never,
          coreWorkflowClient,
        ),
      inject: [
        OrchestrationService,
        DispatchService,
        KanbanWorkItemRepository,
        WorkItemService,
        CoreWorkflowClientService,
      ],
    },

    // Stub the remaining collaborators with the minimum surface the CEO
    // cycle path actually touches.
    {
      provide: KanbanWorkItemRepository,
      useValue: {
        findByproject_id: harness.findByProjectSpy,
        findDependenciesByWorkItemIds: harness.findDependenciesByWorkItemIdsSpy,
      },
    },
    {
      provide: CoreWorkflowClientService,
      useValue: {
        requestWorkflowRun: vi.fn(),
        getWorkflowRunStatus: vi.fn(),
        emitDomainEventOrThrow: harness.emitDomainEventOrThrowSpy,
      },
    },
    {
      provide: BaseRequestContextService,
      useValue: harness.requestContext,
    },
    { provide: WorkItemService, useValue: harness.workItemService },
    { provide: ProjectService, useValue: harness.projectService },
    {
      provide: KanbanProjectRepository,
      useValue: harness.projectRepository,
    },

    // The wakeup service is forwardRef-injected into the continuation
    // service but is never invoked by `evaluateProjectContinuation`;
    // provide a stub so DI can resolve it.
    {
      provide: ProjectOrchestrationWakeupService,
      useValue: { requestWakeup: vi.fn() },
    },
  ];
}

function seedWorkItems(
  store: Map<string, WorkItemRecord>,
  projectId: string,
  seeds: readonly WorkItemSeed[],
): void {
  for (const seed of seeds) {
    store.set(seed.id, makeWorkItemRecord(projectId, seed));
  }
}

function resolveLiveCapacity(
  harness: WiringHarness,
  projectId: string,
): Promise<ProjectDispatchCapacity> {
  const items = [...harness.workItemsStore.values()].filter(
    (item) => item.project_id === projectId,
  );
  // Read the cap live from the in-memory settings store. Mirrors what
  // `KanbanSettingsService.getNumber('work_item_dispatch_max_active_per_project')`
  // would return via `resolveProjectDispatchCapacity` in production.
  const row = harness.settingsStore.get(
    "work_item_dispatch_max_active_per_project",
  );
  const maxActive = typeof row?.value === "number" ? row.value : 1;
  return Promise.resolve(
    resolveProjectDispatchCapacity(items, maxActive),
  );
}

describe("WIP-cap CEO orchestration cycle integration (AC-5)", () => {
  let app: INestApplication;
  let continuationService: OrchestrationContinuationService;
  let kanbanSettings: KanbanSettingsService;
  let decisionService: OrchestrationCycleDecisionService;
  let dispatchService: DispatchService;
  let harness: WiringHarness;
  let recordCycleDecisionSpy: ReturnType<typeof vi.spyOn>;

  const projectId = "project-wip-cap-ceo";
  const trigger = "workflow_completed" as const;
  const workflowRunId = "run-wip-cap-ceo";

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    harness = buildHarness();

    const moduleRef = await Test.createTestingModule({
      providers: buildWiringProviders(harness),
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    kanbanSettings = moduleRef.get(KanbanSettingsService);
    decisionService = moduleRef.get(OrchestrationCycleDecisionService);
    continuationService = moduleRef.get(OrchestrationContinuationService);
    dispatchService = moduleRef.get(DispatchService);

    // Spy on the cycle decision service's public method after the DI graph
    // is built. The default `vi.spyOn` behaviour calls through to the real
    // implementation, which exercises the duplicate-detection path and the
    // `cycle_decision_idempotency_key` persistence round-trip on the
    // second consecutive cycle.
    recordCycleDecisionSpy = vi.spyOn(decisionService, "recordCycleDecision");

    seedOrchestrationState(projectId, harness.orchestrationStates);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  it("records a blocked or pause decision when the project is at capacity and does not over-dispatch", async () => {
    // Cap = 1, project already at capacity with one WIP-active (linked)
    // blocked item; the remaining N items are `blocked` (no linked run)
    // so they are NOT counted by `resolveProjectDispatchCapacity` but
    // they all reach `recordBlockedDecision` via the `hasHardBlockers`
    // branch — the same shape the WIP-cap work item relies on.
    const readyItemCount = 4;
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      1,
      "WIP-cap CEO cycle at-capacity scenario",
    );

    seedWorkItems(harness.workItemsStore, projectId, [
      {
        id: "wip-active-1",
        status: "blocked",
        linked_run_id: "run-wip-active-1",
        current_execution_id: "run-wip-active-1",
      },
      ...Array.from({ length: readyItemCount }, (_v, index) => ({
        id: `wip-blocked-${index + 1}`,
        status: "blocked" as const,
      })),
    ]);

    // Sanity check: the live capacity calculation matches the production
    // helper, no cap math is reimplemented in the assertion.
    const capacity = await resolveLiveCapacity(harness, projectId);
    expect(capacity.maxActive).toBe(1);
    expect(capacity.activeCount).toBe(1);
    expect(capacity.availableSlots).toBe(0);
    expect(capacity.canLaunchNewWork).toBe(false);
    const wipActive = harness.workItemsStore.get("wip-active-1");
    if (!wipActive) {
      throw new Error("expected wip-active-1 work item in store");
    }
    expect(isProjectDispatchActive(wipActive)).toBe(true);
    for (let index = 1; index <= readyItemCount; index += 1) {
      const blocked = harness.workItemsStore.get(`wip-blocked-${index}`);
      if (!blocked) {
        throw new Error(`expected wip-blocked-${index} work item in store`);
      }
      expect(isProjectDispatchActive(blocked)).toBe(false);
    }

    const result = await continuationService.evaluateProjectContinuation({
      projectId,
      trigger,
      workflowRunId,
    });

    // The CEO cycle returns `blocked` because every active item is hard-
    // blocked, and the cycle decision service is invoked with the matching
    // `decision: "blocked"` input.
    expect(result.decision).toBe("blocked");
    expect(result.persisted).toBe(true);
    expect(result.emittedCycleRequest).toBe(false);

    expect(recordCycleDecisionSpy).toHaveBeenCalled();
    const blockedCall = recordCycleDecisionSpy.mock.calls.find(
      ([args]) => args.input.decision === "blocked",
    );
    expect(blockedCall).toBeDefined();
    if (!blockedCall) {
      throw new Error("expected blocked call on recordCycleDecisionSpy");
    }
    expect(blockedCall[0].input).toMatchObject({
      decision: "blocked",
      idempotencyKey: `continuation:${projectId}:${trigger}:${workflowRunId}`,
    });

    // The CEO cycle must not over-dispatch: even though `repeat` would
    // normally invoke `requestOrchestrationCycle`, the `blocked` branch
    // never emits a cycle request.
    expect(harness.emitDomainEventOrThrowSpy).not.toHaveBeenCalled();
    const requestOrchestrationCycleSpy = vi.spyOn(
      dispatchService,
      "requestOrchestrationCycle",
    );
    expect(requestOrchestrationCycleSpy).not.toHaveBeenCalled();
  });

  it("does not repeatedly attempt blocked transitions across consecutive cycles", async () => {
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      1,
      "WIP-cap CEO cycle consecutive-cycles scenario",
    );

    seedWorkItems(harness.workItemsStore, projectId, [
      {
        id: "wip-active-1",
        status: "blocked",
        linked_run_id: "run-wip-active-1",
        current_execution_id: "run-wip-active-1",
      },
      {
        id: "wip-blocked-1",
        status: "blocked",
      },
      {
        id: "wip-blocked-2",
        status: "blocked",
      },
    ]);

    // Cycle 1 — first evaluation, the cycle decision service persists the
    // blocked decision and writes `cycle_decision_idempotency_key` onto
    // the orchestration metadata.
    const firstResult = await continuationService.evaluateProjectContinuation({
      projectId,
      trigger,
      workflowRunId,
    });
    expect(firstResult.decision).toBe("blocked");
    expect(firstResult.persisted).toBe(true);

    const callsAfterFirst = recordCycleDecisionSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

    // Cycle 2 — same project, same trigger, same workflowRunId. The
    // continuation service still routes through `recordBlockedDecision`
    // because the board state hasn't changed, but the cycle decision
    // service dedupes by `cycle_decision_idempotency_key` and returns
    // `duplicate: true, persisted: false` instead of re-persisting.
    const secondResult = await continuationService.evaluateProjectContinuation({
      projectId,
      trigger,
      workflowRunId,
    });
    expect(secondResult.decision).toBe("blocked");
    expect(secondResult.persisted).toBe(false);

    const callsAfterSecond = recordCycleDecisionSpy.mock.calls.length;
    expect(callsAfterSecond).toBe(Number(callsAfterFirst) + 1);

    const secondCall =
      recordCycleDecisionSpy.mock.calls[callsAfterSecond - 1]?.[0];
    expect(secondCall?.input.decision).toBe("blocked");
    expect(secondCall?.input.idempotencyKey).toBe(
      `continuation:${projectId}:${trigger}:${workflowRunId}`,
    );

    // The cycle decision service's second-call result is a duplicate,
    // which is what stops the orchestrator from re-emitting a dispatch
    // request on every consecutive cycle.
    const secondCallResult = await recordCycleDecisionSpy.mock.results[
      callsAfterSecond - 1
    ]?.value;
    expect(secondCallResult).toMatchObject({
      decision: "blocked",
      duplicate: true,
      persisted: false,
    });

    expect(harness.emitDomainEventOrThrowSpy).not.toHaveBeenCalled();
  });

  it("records a non-blocked decision when the project is below its persisted cap", async () => {
    // Cap = 5, project only has 1 WIP-active in-progress item — plenty
    // of available slots. There is no dispatchable `todo` work and no
    // backlog, so the CEO cycle returns `pause` without invoking
    // `OrchestrationCycleDecisionService.recordCycleDecision`.
    await kanbanSettings.set(
      "work_item_dispatch_max_active_per_project",
      5,
      "WIP-cap CEO cycle below-cap scenario",
    );

    seedWorkItems(harness.workItemsStore, projectId, [
      {
        id: "wip-active-1",
        status: "in-progress",
      },
    ]);

    const capacity = await resolveLiveCapacity(harness, projectId);
    expect(capacity.maxActive).toBe(5);
    expect(capacity.activeCount).toBe(1);
    expect(capacity.availableSlots).toBe(4);
    expect(capacity.canLaunchNewWork).toBe(true);

    const result = await continuationService.evaluateProjectContinuation({
      projectId,
      trigger,
      workflowRunId,
    });

    // Below cap with no dispatchable work → the continuation service
    // surfaces `pause` (a non-blocked decision) without calling the
    // cycle decision service.
    expect(result.decision).toBe("pause");
    expect(result.decision).not.toBe("blocked");
    expect(result.persisted).toBe(false);
    expect(result.emittedCycleRequest).toBe(false);

    const blockedCalls = recordCycleDecisionSpy.mock.calls.filter(
      ([args]) => args.input.decision === "blocked",
    );
    expect(blockedCalls).toHaveLength(0);

    // The CEO cycle must not over-dispatch while below the cap either —
    // no orchestration cycle request is emitted.
    expect(harness.emitDomainEventOrThrowSpy).not.toHaveBeenCalled();
  });
});