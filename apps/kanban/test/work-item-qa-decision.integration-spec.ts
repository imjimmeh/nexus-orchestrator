import { CanActivate, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { BaseRequestContextService } from "@nexus/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreWorkflowClientService } from "../src/core/core-workflow-client.service";
import { KanbanPermissionsGuard } from "../src/common/kanban-permissions.guard";
import { KanbanLifecycleEventPublisher } from "../src/work-item/kanban-lifecycle-event-publisher";
import { WorkItemController } from "../src/work-item/work-item.controller";
import { WorkItemService } from "../src/work-item/work-item.service";
import { KanbanSettingsService } from "../src/settings/kanban-settings.service";
import { KanbanWorkItemRepository } from "../src/database/repositories/kanban-work-item.repository";
import { KanbanWorkItemRunCostRepository } from "../src/database/repositories/kanban-work-item-run-cost.repository";
import { KanbanProjectRepository } from "../src/database/repositories/kanban-project.repository";
import { WorkItemRealtimePublisher } from "../src/work-item/work-item-realtime.publisher";
import { WorkItemRealtimeGateway } from "../src/work-item/work-item-realtime.gateway";
import { WorkItemRunLeaseService } from "../src/work-item/work-item-run-lease";
import { OrchestrationLeaseService } from "../src/orchestration/control-plane/orchestration-lease.service";
import { KanbanOrchestrationLeaseRepository } from "../src/database/repositories/kanban-orchestration-lease.repository";
import { WorkItemCostEstimationService } from "../src/work-item/cost-estimation/work-item-cost-estimation.service";

const allowAllGuard: CanActivate = { canActivate: () => true };

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

function makeWorkItem(overrides: Partial<StoredWorkItem>): StoredWorkItem {
  const now = new Date("2026-05-17T00:00:00.000Z");
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Review me",
    status: "in-review",
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

describe("Work item QA decision integration", () => {
  let app: INestApplication;
  let store: Map<string, StoredWorkItem>;
  const requestWorkflowRun = vi.fn();

  beforeEach(async () => {
    store = new Map([["wi-1", makeWorkItem({})]]);
    requestWorkflowRun.mockResolvedValue({
      run_id: "run-1",
      workflow_id: "workflow-review",
    });

    const repository = {
      findByProjectAndId: vi.fn((project_id: string, id: string) => {
        const item = store.get(id);
        return Promise.resolve(item?.project_id === project_id ? item : null);
      }),
      save: vi.fn((item: StoredWorkItem) => {
        const saved = {
          ...item,
          updated_at: new Date("2026-05-17T00:00:01.000Z"),
        };
        store.set(saved.id, saved);
        return Promise.resolve(saved);
      }),
      findDependenciesByWorkItemIds: vi.fn().mockResolvedValue([]),
      findSubtasksByWorkItemIds: vi.fn().mockResolvedValue([]),
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
      findByProjectAndIdForUpdate: vi.fn(
        (project_id: string, workItemId: string) => {
          const item = store.get(workItemId);
          return Promise.resolve(item?.project_id === project_id ? item : null);
        },
      ),
    };

    // A fake OrchestrationLeaseService whose `acquireMutationLeases`
    // always succeeds — the integration test only exercises the
    // /qa-decision route happy paths, so it does not need to simulate
    // serialization or contention on the per-work-item lease. The
    // WorkItemRunLeaseService is wired to the real wrapper so its
    // owner-id derivation matches the production contract end-to-end
    // without requiring a Postgres lease table.
    const orchestrationLeaseRepositoryMock = {
      acquire: vi.fn(
        (input: {
          projectId: string;
          conflictKeys: Array<{ kind: string; value: string }>;
          ttlMs: number;
          owner: { kind: string; id: string };
        }) => {
          const leaseIds: string[] = [];
          let seq = 0;
          for (const _key of input.conflictKeys) {
            seq += 1;
            leaseIds.push(`lease-${input.projectId}-${seq}`);
          }
          return Promise.resolve({ acquired: true as const, leaseIds });
        },
      ),
      releaseOwned: vi.fn(() => Promise.resolve(undefined)),
      listActiveByProject: vi.fn(() => Promise.resolve([])),
      countActiveByLane: vi.fn(() => Promise.resolve(0)),
      listActiveByLane: vi.fn(() => Promise.resolve([])),
    };
    const orchestrationLeaseService = new OrchestrationLeaseService(
      orchestrationLeaseRepositoryMock as never,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkItemController],
      providers: [
        WorkItemService,
        { provide: KanbanWorkItemRepository, useValue: repository },
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
          useValue: { requestWorkflowRun },
        },
        {
          provide: BaseRequestContextService,
          useValue: {
            getRequestId: () => "req-1",
            getCausationId: () => "cause-1",
          },
        },
        {
          provide: KanbanLifecycleEventPublisher,
          useValue: { emitStatusChanged: vi.fn().mockResolvedValue(undefined) },
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
          useValue: orchestrationLeaseService,
        },
        {
          // Avoid Nest trying to resolve the real repo via DI; the
          // fake instance above already owns the contract.
          provide: KanbanOrchestrationLeaseRepository,
          useValue: orchestrationLeaseRepositoryMock,
        },
        {
          // Lease rollback flag enabled (default). The flag is
          // read by requestWorkItemRun via `getBoolean`; the
          // default value `work_item_run_lease_enabled = true`
          // keeps the per-work-item lease in front of every
          // request call (see
          // docs/operations/README.md#work-item-run-link-lease-contention
          // for the rollback runbook).
          provide: KanbanSettingsService,
          useValue: {
            getBoolean: vi.fn((key: string) =>
              Promise.resolve(key === "work_item_run_lease_enabled"),
            ),
            getNumber: vi.fn(),
            get: vi.fn(),
            getAll: vi.fn(),
            set: vi.fn(),
            seedDefaults: vi.fn(),
            onModuleInit: vi.fn(),
          },
        },
      ],
    })
      .overrideGuard(KanbanPermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  it("reject returns the work item to in-progress and persists rejection feedback", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/project-1/work-items/wi-1/qa-decision")
      .send({
        decision: "reject",
        workflow_id: "workflow-review",
        feedback: "Missing acceptance criteria",
      })
      .expect(201);

    expect(response.body.data.workItem.status).toBe("in-progress");
    expect(response.body.data.workItem.metadata).toMatchObject({
      qa_decision: "reject",
      qa_rejection_feedback: "Missing acceptance criteria",
    });
    expect(requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-review",
        input: expect.objectContaining({
          action: "review",
          decision: "reject",
          feedback: "Missing acceptance criteria",
        }),
      }),
    );
  });

  it("approve moves the work item to ready-to-merge", async () => {
    const response = await request(app.getHttpServer())
      .post("/projects/project-1/work-items/wi-1/qa-decision")
      .send({ decision: "approve", workflow_id: "workflow-review" })
      .expect(201);

    expect(response.body.data.workItem.status).toBe("ready-to-merge");
    expect(response.body.data.workItem.metadata).toMatchObject({
      qa_decision: "approve",
    });
  });

  it("rejects missing workflow_id with a 400-level validation error", async () => {
    await request(app.getHttpServer())
      .post("/projects/project-1/work-items/wi-1/qa-decision")
      .send({ decision: "approve" })
      .expect(400);

    expect(requestWorkflowRun).not.toHaveBeenCalled();
  });
});
