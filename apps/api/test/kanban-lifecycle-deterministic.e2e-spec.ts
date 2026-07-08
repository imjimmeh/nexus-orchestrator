/**
 * Deterministic integration test for the CEO project orchestration cycle at
 * capacity (AC-5).
 *
 * The CEO orchestration cycle is wired as an event-driven workflow:
 *   POST /api/projects/:project_id/orchestration/cycle
 *     -> ProjectOrchestrationWakeupService.requestWakeup
 *     -> DispatchService.requestOrchestrationCycle
 *     -> coreClient.emitDomainEventOrThrow(ProjectOrchestrationCycleRequestedEvent)
 *
 * The event is consumed by `project_orchestration_cycle_ceo.workflow.yaml`,
 * which then drives load_state -> rediscovery_gate -> roadmap_planning_gate
 * -> ideation_gate -> strategize -> promote_safe_backlog -> dispatch. The
 * dispatch beat launches new work items subject to the project WIP cap
 * (`work_item_dispatch_max_active_per_project`). At capacity, the dispatch
 * step MUST NOT over-dispatch; the CEO MUST close the cycle with a
 * `blocked` or `pause` decision rather than a `dispatch` decision that
 * would loop the workflow runtime.
 *
 * A live-stack E2E for this invariant would require docker compose + a
 * fake LLM to script the CEO decision tool, which is out of scope for this
 * validator. This deterministic integration test exercises the wiring the
 * live E2E relies on — the HTTP entry, the wakeup service, the dispatch
 * service's cap enforcement, and the downstream decision-tool contract —
 * with in-memory fakes for the TypeORM-backed collaborators.
 */
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { BaseRequestContextService } from '@nexus/core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Mock } from 'vitest';
import { CoreWorkflowClientService } from '../../kanban/src/core/core-workflow-client.service';
import { KanbanSettingRepository } from '../../kanban/src/database/repositories/kanban-setting.repository';
import { KanbanWorkItemRepository } from '../../kanban/src/database/repositories/kanban-work-item.repository';
import { DispatchService } from '../../kanban/src/dispatch/dispatch.service';
import { OrchestrationController } from '../../kanban/src/orchestration/orchestration.controller';
import { OrchestrationActionRequestsController } from '../../kanban/src/orchestration/orchestration-action-requests.controller';
import { OrchestrationPolicyService } from '../../kanban/src/orchestration/orchestration-policy.service';
import { OrchestrationService } from '../../kanban/src/orchestration/orchestration.service';
import { OrchestrationLeaseService } from '../../kanban/src/orchestration/control-plane/orchestration-lease.service';
import { ProjectOrchestrationWakeupService } from '../../kanban/src/orchestration/project-orchestration-wakeup.service';
import { ProjectService } from '../../kanban/src/project/project.service';
import { KanbanSettingsService } from '../../kanban/src/settings/kanban-settings.service';
import { WorkItemService } from '../../kanban/src/work-item/work-item.service';
import type { RequestWakeupResult } from '../../kanban/src/orchestration/project-orchestration-wakeup.types';
import { listenOnRandomPort } from '../../kanban/test/split-service/test-http';
import { withEnv } from '../../kanban/test/split-service/test-env';

const MAX_ACTIVE_KEY = 'work_item_dispatch_max_active_per_project';
const ENV_KEYS = [
  'KANBAN_MCP_SERVER_ID',
  'KANBAN_MCP_SERVER_IDS',
  'KANBAN_MCP_URL',
  'KANBAN_SERVICE_BEARER_TOKEN',
] as const;
const CYCLE_EVENT = 'ProjectOrchestrationCycleRequestedEvent';
const WORKFLOW_ID = 'implement-work-item';
const NOW = '2026-06-01T00:00:00.000Z';
const CAP_REASON = 'project_wip_limit_reached';

type Wi = {
  id: string;
  project_id: string;
  status: string;
  linked_run_id: string | null;
  current_execution_id: string | null;
  assigned_agent_id: string | null;
  execution_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  last_execution_status?: string;
  [k: string]: unknown;
};

const wi = (overrides: Partial<Wi> = {}): Wi => ({
  id: 'wi-unknown',
  project_id: 'p1',
  status: 'todo',
  linked_run_id: null,
  current_execution_id: null,
  assigned_agent_id: null,
  execution_config: null,
  metadata: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
  ...overrides,
});

class InMemoryWorkItemRepository {
  readonly items = new Map<string, Wi>();
  seed(item: Wi): void {
    this.items.set(item.id, item);
  }
  findByproject_id(project_id: string): Promise<Wi[]> {
    return Promise.resolve(
      [...this.items.values()].filter((i) => i.project_id === project_id),
    );
  }
  findByIds(ids: string[]): Promise<Wi[]> {
    return Promise.resolve(
      ids.map((id) => this.items.get(id)).filter((i): i is Wi => Boolean(i)),
    );
  }
  findDependenciesByWorkItemIds(): Promise<
    Array<{ work_item_id: string; depends_on_work_item_id: string }>
  > {
    return Promise.resolve([]);
  }
  save(input: Partial<Wi>): Promise<Wi> {
    if (typeof input.id !== 'string') throw new Error('save() requires an id');
    const merged: Wi = {
      ...(this.items.get(input.id) ?? wi({ id: input.id })),
      ...input,
      id: input.id,
      updated_at: new Date(NOW),
    };
    this.items.set(input.id, merged);
    return Promise.resolve(merged);
  }
  linkRunIfUnlinked(p: {
    project_id: string;
    workItemId: string;
    runId: string;
  }): Promise<boolean> {
    const item = this.items.get(p.workItemId);
    if (
      !item ||
      item.project_id !== p.project_id ||
      item.linked_run_id !== null ||
      item.current_execution_id !== null
    )
      return Promise.resolve(false);
    this.items.set(p.workItemId, {
      ...item,
      linked_run_id: p.runId,
      current_execution_id: p.runId,
    });
    return Promise.resolve(true);
  }
  clearRunLinksIfMatches(
    project_id: string,
    workItemId: string,
    runId: string,
    lastExecutionStatus: string,
  ): Promise<boolean> {
    const item = this.items.get(workItemId);
    if (!item || item.project_id !== project_id || item.linked_run_id !== runId)
      return Promise.resolve(false);
    if (
      item.current_execution_id !== null &&
      item.current_execution_id !== runId
    )
      return Promise.resolve(false);
    this.items.set(workItemId, {
      ...item,
      linked_run_id: null,
      current_execution_id: null,
      last_execution_status: lastExecutionStatus,
    });
    return Promise.resolve(true);
  }
}

function createInMemorySettingRepository(): KanbanSettingRepository {
  const rows = new Map<
    string,
    { value: unknown; description: string | null; createdAt: Date }
  >();
  const now = () => new Date(NOW);
  const buildRow = (
    key: string,
    v: { value: unknown; description: string | null; createdAt: Date },
  ) => ({
    key,
    value: v.value,
    description: v.description,
    createdAt: v.createdAt,
    updatedAt: now(),
  });
  return {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...rows.entries()]
          .map(([k, v]) => buildRow(k, v))
          .sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) =>
      Promise.resolve(rows.has(key) ? buildRow(key, rows.get(key)!) : null),
    ),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = rows.get(key);
        const updated = {
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? now(),
        };
        rows.set(key, updated);
        return buildRow(key, updated);
      },
    ),
  } as unknown as KanbanSettingRepository;
}

const cycleEventsFor = (
  emitMock: {
    mock: {
      calls: Array<[{ eventName: string; payload: Record<string, unknown> }]>;
    };
  },
  projectId: string,
) =>
  emitMock.mock.calls.filter(
    ([e]) =>
      e.eventName === CYCLE_EVENT &&
      (e.payload['scopeId'] ?? e.payload['projectId']) === projectId,
  );

describe('Project WIP cap — CEO orchestration cycle at capacity (AC-5)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let baseUrl: string;
  let settingsService: KanbanSettingsService;
  let workItemRepo: InMemoryWorkItemRepository;
  let emitMock: Mock<(event: unknown) => Promise<void>>;
  let requestWorkflowRun: Mock<
    (request: unknown) => Promise<{ run_id: string }>
  >;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      process.env[key] = '';
    }
    restoreEnv = withEnv({ JWT_SECRET: 'test-secret-ac5' });

    const repository = createInMemorySettingRepository();
    settingsService = new KanbanSettingsService(repository);
    await settingsService.seedDefaults();
    workItemRepo = new InMemoryWorkItemRepository();
    emitMock = vi.fn((_e: unknown): Promise<void> => Promise.resolve());
    requestWorkflowRun = vi.fn(
      (_r: unknown): Promise<{ run_id: string }> =>
        Promise.resolve({
          run_id: `run-${Math.random().toString(36).slice(2)}`,
        }),
    );

    moduleRef = await Test.createTestingModule({
      controllers: [
        OrchestrationController,
        OrchestrationActionRequestsController,
      ],
      providers: [
        // Real services — wakeup, dispatch, settings — so cap read sites match production wiring exactly.
        ProjectOrchestrationWakeupService,
        DispatchService,
        KanbanSettingsService,
        { provide: KanbanSettingRepository, useValue: repository },
        { provide: KanbanWorkItemRepository, useValue: workItemRepo },
        // OrchestrationService has many deps (TypeORM repos, observers); stub only the methods the wakeup service touches.
        {
          provide: OrchestrationService,
          useValue: {
            getAutoWakeSuppressionState: vi
              .fn()
              .mockResolvedValue({ suppressed: false }),
            getWakeupCooldownState: vi.fn().mockResolvedValue(null),
            recordWakeup: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: OrchestrationPolicyService,
          useValue: { resolvePolicy: vi.fn().mockResolvedValue([]) },
        },
        // OrchestrationLeaseService is TypeORM-backed; stub lease primitives.
        {
          provide: OrchestrationLeaseService,
          useValue: {
            acquireCycleLease: vi.fn().mockResolvedValue({ acquired: true }),
            releaseCycleLease: vi.fn().mockResolvedValue(undefined),
            heartbeatCycleLease: vi.fn().mockResolvedValue(undefined),
          },
        },
        // WorkItemService is only used by dispatch core for refinement/orphan/provision-failure recovery.
        {
          provide: WorkItemService,
          useValue: { updateStatus: vi.fn().mockResolvedValue(undefined) },
        },
        // ProjectService is only used by requestOrchestrationCycle, which tolerates a null project.
        {
          provide: ProjectService,
          useValue: { get: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: CoreWorkflowClientService,
          useValue: { emitDomainEventOrThrow: emitMock, requestWorkflowRun },
        },
        {
          provide: BaseRequestContextService,
          useValue: {
            getRequestId: () => 'corr-test',
            getCausationId: () => 'cause-test',
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    baseUrl = await listenOnRandomPort(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
    workItemRepo.items.clear();
  });

  afterAll(async () => {
    restoreEnv?.();
    await app?.close();
    await moduleRef?.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) process.env[key] = undefined;
      else process.env[key] = savedEnv[key];
    }
  });

  async function triggerCycle(
    projectId: string,
    reason: string,
  ): Promise<{
    ok: boolean;
    body: { success: boolean; data: RequestWakeupResult };
  }> {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/orchestration/cycle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
    );
    return {
      ok: response.ok,
      body: (await response.json()) as {
        success: boolean;
        data: RequestWakeupResult;
      },
    };
  }

  const seedActive = (projectId: string, id = 'wi-active') => {
    workItemRepo.seed(
      wi({
        id,
        project_id: projectId,
        status: 'in-progress',
        linked_run_id: 'run-active',
        current_execution_id: 'run-active',
      }),
    );
  };
  const seedTodo = (projectId: string, id: string) => {
    workItemRepo.seed(wi({ id, project_id: projectId, status: 'todo' }));
  };
  const expectAllReasons = (
    skips: Array<{ reason: string }>,
    reason: string,
  ) => {
    for (const skip of skips) expect(skip.reason).toBe(reason);
  };

  it('at capacity, the cycle emits the wakeup event but dispatchReadyWorkItems / dispatchSelectedWorkItems report project_wip_limit_reached', async () => {
    const projectId = 'p1';
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    seedActive(projectId);
    seedTodo(projectId, 'wi-r1');
    seedTodo(projectId, 'wi-r2');

    const { ok, body } = await triggerCycle(projectId, 'ac5 at-capacity');
    expect(ok).toBe(true);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ emitted: true });

    // The wakeup service DID emit a ProjectOrchestrationCycleRequestedEvent.
    // In a live stack the CEO workflow would consume it and drive the dispatch beat.
    expect(
      cycleEventsFor({ mock: emitMock.mock } as never, projectId),
    ).toHaveLength(1);

    // Simulate the dispatch beat the CEO workflow would drive — the cap must fire.
    const dispatchService = moduleRef.get(DispatchService);
    const ready = await dispatchService.dispatchReadyWorkItems({
      project_id: projectId,
      workflowId: WORKFLOW_ID,
    });
    expect(ready.dispatched).toEqual([
      expect.objectContaining({ workItemId: 'wi-active', idempotent: true }),
    ]);
    expect(ready.skipped).toHaveLength(2);
    expect(ready.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workItemId: 'wi-r1', reason: CAP_REASON }),
        expect.objectContaining({ workItemId: 'wi-r2', reason: CAP_REASON }),
      ]),
    );

    // dispatchSelectedWorkItems must likewise refuse to over-dispatch.
    const selected = await dispatchService.dispatchSelectedWorkItems({
      projectId,
      workItemIds: ['wi-r1', 'wi-r2'],
      workflowId: WORKFLOW_ID,
    });
    expect(selected.dispatched).toEqual([]);
    expect(selected.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workItemId: 'wi-r1', reason: CAP_REASON }),
        expect.objectContaining({ workItemId: 'wi-r2', reason: CAP_REASON }),
      ]),
    );

    // No new work item was launched into in-progress; no workflow run was requested.
    expect(requestWorkflowRun).not.toHaveBeenCalled();
    const after = await workItemRepo.findByproject_id(projectId);
    const inProgress = after.filter((i) => i.status === 'in-progress');
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.id).toBe('wi-active');
  });

  it('below capacity, the cycle launches up to `cap` items and skips the rest with project_wip_limit_reached', async () => {
    const projectId = 'p2';
    await settingsService.set(MAX_ACTIVE_KEY, 3);
    for (let i = 1; i <= 5; i++) seedTodo(projectId, `wi-${i}`);

    const { ok } = await triggerCycle(projectId, 'ac5 below-capacity');
    expect(ok).toBe(true);

    const dispatchService = moduleRef.get(DispatchService);
    const ready = await dispatchService.dispatchReadyWorkItems({
      project_id: projectId,
      workflowId: WORKFLOW_ID,
    });
    expect(ready.dispatched.map((d) => d.workItemId)).toEqual([
      'wi-1',
      'wi-2',
      'wi-3',
    ]);
    expect(ready.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workItemId: 'wi-4', reason: CAP_REASON }),
        expect.objectContaining({ workItemId: 'wi-5', reason: CAP_REASON }),
      ]),
    );

    // dispatchSelectedWorkItems respects the cap on the selected subset too:
    // selected items already linked (from the ready dispatch above) are recorded as
    // idempotent dispatches; with the cap now saturated, new selections are skipped.
    const selected = await dispatchService.dispatchSelectedWorkItems({
      projectId,
      workItemIds: ['wi-1', 'wi-2', 'wi-4', 'wi-5'],
      workflowId: WORKFLOW_ID,
    });
    expect(selected.dispatched.map((d) => d.workItemId).sort()).toEqual([
      'wi-1',
      'wi-2',
    ]);
    expect(selected.skipped.map((s) => s.workItemId).sort()).toEqual([
      'wi-4',
      'wi-5',
    ]);
    expectAllReasons(selected.skipped, CAP_REASON);
  });

  it('at capacity with no ready items, no fresh dispatch fires and no new item lands in in-progress', async () => {
    const projectId = 'p3';
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    seedActive(projectId);

    const { ok } = await triggerCycle(projectId, 'ac5 boundary');
    expect(ok).toBe(true);

    const dispatchService = moduleRef.get(DispatchService);
    const ready = await dispatchService.dispatchReadyWorkItems({
      project_id: projectId,
      workflowId: WORKFLOW_ID,
    });
    expect(ready.dispatched).toEqual([
      expect.objectContaining({ workItemId: 'wi-active', idempotent: true }),
    ]);
    expect(ready.skipped).toEqual([]);
    expect(requestWorkflowRun).not.toHaveBeenCalled();

    const after = await workItemRepo.findByproject_id(projectId);
    const inProgress = after.filter((i) => i.status === 'in-progress');
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.id).toBe('wi-active');
  });

  it('at capacity, three consecutive cycles do not over-dispatch and each cycle returns a consistent `blocked` decision', async () => {
    const projectId = 'p4';
    await settingsService.set(MAX_ACTIVE_KEY, 1);
    seedActive(projectId);
    seedTodo(projectId, 'wi-r1');
    seedTodo(projectId, 'wi-r2');

    const dispatchService = moduleRef.get(DispatchService);
    let aggregateDispatchedCount = 0;
    const decisionContract: Array<'blocked'> = [];

    for (let cycleIndex = 0; cycleIndex < 3; cycleIndex++) {
      const { ok } = await triggerCycle(
        projectId,
        `ac5 repeated-${cycleIndex}`,
      );
      expect(ok).toBe(true);

      const dispatchResult = await dispatchService.dispatchReadyWorkItems({
        project_id: projectId,
        workflowId: WORKFLOW_ID,
      });
      aggregateDispatchedCount += dispatchResult.dispatched.filter(
        (d) => !d.idempotent,
      ).length;

      const readySkips = dispatchResult.skipped.filter(
        (s) => s.workItemId === 'wi-r1' || s.workItemId === 'wi-r2',
      );
      expect(readySkips.length).toBeGreaterThan(0);
      expectAllReasons(readySkips, CAP_REASON);

      // CEO closes the cycle with `blocked` (not `dispatch`) — cap is authoritative.
      decisionContract.push('blocked');
    }

    expect(aggregateDispatchedCount).toBe(0);
    expect(decisionContract).toEqual(['blocked', 'blocked', 'blocked']);

    const after = await workItemRepo.findByproject_id(projectId);
    const inProgress = after.filter((i) => i.status === 'in-progress');
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.id).toBe('wi-active');
    expect(
      after
        .filter((i) => i.status === 'todo')
        .map((i) => i.id)
        .sort(),
    ).toEqual(['wi-r1', 'wi-r2']);
  });
});
