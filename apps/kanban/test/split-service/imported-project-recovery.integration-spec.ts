import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BaseRequestContextService } from "@nexus/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import { InternalServiceAuthGuard } from "../../src/common/internal-service-auth.guard";
import { CoreEventsController } from "../../src/core/core-events.controller";
import { CoreLifecycleStreamConsumerService } from "../../src/core/core-lifecycle-stream.consumer";
import { CoreRunProjectionService } from "../../src/core/core-run-projection.service";
import { CoreScopeClientService } from "../../src/core/core-scope-client.service";
import { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import { KANBAN_REDIS_CLIENT } from "../../src/core/kanban-redis.constants";
import { KanbanCoreLifecycleCursorEntity } from "../../src/database/entities/kanban-core-lifecycle-cursor.entity";
import { KanbanCoreLifecycleDeadLetterEntity } from "../../src/database/entities/kanban-core-lifecycle-dead-letter.entity";
import { KanbanCoreRunProjectionEntity } from "../../src/database/entities/kanban-core-run-projection.entity";
import { KanbanEventDeliveryProjectionEntity } from "../../src/database/entities/kanban-event-delivery-projection.entity";
import { KanbanOrchestrationEntity } from "../../src/database/entities/kanban-orchestration.entity";
import { KanbanProjectGoalWorklogEntity } from "../../src/database/entities/kanban-project-goal-worklog.entity";
import { KanbanProjectGoalEntity } from "../../src/database/entities/kanban-project-goal.entity";
import { KanbanProjectEntity } from "../../src/database/entities/kanban-project.entity";
import { KanbanWorkItemDependencyEntity } from "../../src/database/entities/kanban-work-item-dependency.entity";
import { KanbanWorkItemSubtaskEntity } from "../../src/database/entities/kanban-work-item-subtask.entity";
import { KanbanWorkItemEntity } from "../../src/database/entities/kanban-work-item.entity";
import { KanbanCoreLifecycleCursorRepository } from "../../src/database/repositories/kanban-core-lifecycle-cursor.repository";
import { KanbanCoreLifecycleDeadLetterRepository } from "../../src/database/repositories/kanban-core-lifecycle-dead-letter.repository";
import { KanbanCoreRunProjectionRepository } from "../../src/database/repositories/kanban-core-run-projection.repository";
import { KanbanEventDeliveryProjectionRepository } from "../../src/database/repositories/kanban-event-delivery-projection.repository";
import { KanbanOrchestrationRepository } from "../../src/database/repositories/kanban-orchestration.repository";
import { KanbanProjectGoalRepository } from "../../src/database/repositories/kanban-project-goal.repository";
import { KanbanProjectRepository } from "../../src/database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../../src/database/repositories/kanban-work-item.repository";
import { DispatchController } from "../../src/dispatch/dispatch.controller";
import { DispatchService } from "../../src/dispatch/dispatch.service";
import { KanbanMcpAuditService } from "../../src/mcp/kanban-mcp-audit.service";
import { KanbanMcpService } from "../../src/mcp/kanban-mcp.service";
import { PublishSpecsTool } from "../../src/mcp/tools/publish-specs/publish-specs.tool";
import { KANBAN_INTERNAL_TOOL_HANDLER } from "../../src/mcp/tools/shared/tokens";
import { OrchestrationControlPlaneSchedulerService } from "../../src/orchestration/control-plane/orchestration-control-plane-scheduler.service";
import { OrchestrationLeaseService } from "../../src/orchestration/control-plane/orchestration-lease.service";
import { OrchestrationRepairLaneService } from "../../src/orchestration/control-plane/orchestration-repair-lane.service";
import { HumanDecisionResolutionPolicyService } from "../../src/orchestration/human-decision-resolution-policy.service";
import { OrchestrationContinuationReconcilerService } from "../../src/orchestration/orchestration-continuation-reconciler.service";
import { OrchestrationService } from "../../src/orchestration/orchestration.service";
import { ProjectStrategicStateService } from "../../src/orchestration/strategic/project-strategic-state.service";
import { ProjectOrchestrationWakeupService } from "../../src/orchestration/project-orchestration-wakeup.service";
import { CharterRegenEnqueuer } from "../../src/project/charter-regen.enqueuer";
import { ManagedProjectCloneService } from "../../src/project/managed-project-clone.service";
import { ProjectMemorySummaryService } from "../../src/project/project-memory-summary.service";
import { ProjectService } from "../../src/project/project.service";
import { KanbanRetrospectiveService } from "../../src/retrospectives/kanban-retrospective.service";
import {
  KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
} from "../../src/retrospectives/kanban-retrospective-failure-threshold.types";
import { KanbanSettingsService } from "../../src/settings/kanban-settings.service";
import { KanbanLifecycleEventPublisher } from "../../src/work-item/kanban-lifecycle-event-publisher";
import { WorkItemRealtimeGateway } from "../../src/work-item/work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "../../src/work-item/work-item-realtime.publisher";
import { WorkItemService } from "../../src/work-item/work-item.service";
import { getCycleRequestsForProject } from "./project-orchestration-cycle-request-test.helpers";
import { withEnv } from "./test-env";
import { listenOnRandomPort } from "./test-http";

const POSTGRES_IMAGE = "postgres:18-alpine";
const POSTGRES_PORT = 5432;
const DB_NAME = "nexus_orchestrator";
const DB_USERNAME = "nexus";
const DB_PASSWORD = "nexus_password";
const TEST_TIMEOUT_MS = 120_000;
const KANBAN_SERVICE_TOKEN = "kanban-internal-token";

const entities = [
  KanbanProjectEntity,
  KanbanWorkItemEntity,
  KanbanWorkItemDependencyEntity,
  KanbanWorkItemSubtaskEntity,
  KanbanProjectGoalEntity,
  KanbanProjectGoalWorklogEntity,
  KanbanOrchestrationEntity,
  KanbanCoreRunProjectionEntity,
  KanbanCoreLifecycleCursorEntity,
  KanbanCoreLifecycleDeadLetterEntity,
  KanbanEventDeliveryProjectionEntity,
];

type CoreWorkflowClientMock = {
  requestWorkflowRun: Mock<CoreWorkflowClientService["requestWorkflowRun"]>;
  getWorkflowRunStatus: Mock<CoreWorkflowClientService["getWorkflowRunStatus"]>;
  emitDomainEvent: Mock<CoreWorkflowClientService["emitDomainEvent"]>;
  emitEventLedger: Mock<CoreWorkflowClientService["emitEventLedger"]>;
  cancelWorkflowRunsByScope: Mock<
    CoreWorkflowClientService["cancelWorkflowRunsByScope"]
  >;
  retrieveSecret: Mock<CoreWorkflowClientService["retrieveSecret"]>;
  commitPaths: Mock<CoreWorkflowClientService["commitPaths"]>;
};

type InMemoryCoreLifecycleStreamEntry = [string, string[]];

class InMemoryCoreLifecycleRedis {
  private readonly entries: InMemoryCoreLifecycleStreamEntry[] = [];

  appendEnvelope(envelope: Record<string, unknown>): void {
    const streamId = `${this.entries.length + 1}-0`;
    this.entries.push([streamId, ["envelope", JSON.stringify(envelope)]]);
  }

  xrange(
    _key: string,
    start: string,
    _end: string,
  ): Promise<InMemoryCoreLifecycleStreamEntry[]> {
    const exclusiveStart = start.startsWith("(") ? start.slice(1) : null;
    if (!exclusiveStart || start === "-") {
      return Promise.resolve([...this.entries]);
    }

    return Promise.resolve(
      this.entries.filter(([streamId]) => streamId > exclusiveStart),
    );
  }
}

// Detect whether a container runtime (Docker) is available before
// attempting to start a test Postgres via testcontainers. The
// in-container CI runner may not expose a docker socket, in which
// case we skip the suite rather than fail the whole gate. This
// mirrors the conditional-skip pattern used by
// `apps/api/src/memory/memory-drift-detection.integration.spec.ts`.
async function detectContainerRuntime(): Promise<boolean> {
  if (
    process.env["DOCKER_HOST"] ||
    process.env["TESTCONTAINERS_HOST_OVERRIDE"]
  ) {
    return true;
  }
  try {
    const { access } = await import("node:fs/promises");
    await access("/var/run/docker.sock");
    return true;
  } catch {
    return false;
  }
}

if (!(await detectContainerRuntime())) {
   
  console.warn(
    "[imported-project-recovery] Skipping integration suite: a container runtime is not available in this environment.",
  );
}

describe.skipIf(!(await detectContainerRuntime()))(
  "EPIC-170 imported project orchestration recovery integration",
  () => {
  let postgresContainer: StartedTestContainer;
  let moduleRef: TestingModule;
  let app: INestApplication;
  let baseUrl: string;
  let restoreEnv: () => void;
  let tempDirs: string[];
  let coreClient: CoreWorkflowClientMock;
  let coreLifecycleRedis: InMemoryCoreLifecycleRedis;
  let projectService: ProjectService;
  let workItemService: WorkItemService;
  let workItemsRepository: KanbanWorkItemRepository;
  let projectGoals: KanbanProjectGoalRepository;
  let runProjections: KanbanCoreRunProjectionRepository;
  let orchestrationService: OrchestrationService;
  let lifecycleConsumer: CoreLifecycleStreamConsumerService;
  let reconciler: OrchestrationContinuationReconcilerService;
  let mcpService: KanbanMcpService;

  beforeAll(async () => {
    restoreEnv = withEnv({
      KANBAN_SERVICE_BEARER_TOKEN: KANBAN_SERVICE_TOKEN,
      KANBAN_CORE_LIFECYCLE_POLL_INTERVAL_MS: "600000",
      KANBAN_CONTINUATION_RECONCILE_INTERVAL_MS: "600000",
    });

    postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({
        POSTGRES_DB: DB_NAME,
        POSTGRES_USER: DB_USERNAME,
        POSTGRES_PASSWORD: DB_PASSWORD,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 2),
      )
      .withStartupTimeout(TEST_TIMEOUT_MS)
      .start();
    const postgresHost =
      postgresContainer.getHost() === "localhost"
        ? "127.0.0.1"
        : postgresContainer.getHost();

    coreClient = createCoreClientMock();
    coreLifecycleRedis = new InMemoryCoreLifecycleRedis();

    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          host: postgresHost,
          port: postgresContainer.getMappedPort(POSTGRES_PORT),
          username: DB_USERNAME,
          password: DB_PASSWORD,
          database: DB_NAME,
          entities,
          synchronize: true,
          dropSchema: true,
          logging: false,
        }),
        TypeOrmModule.forFeature(entities),
      ],
      controllers: [DispatchController, CoreEventsController],
      providers: [
        BaseRequestContextService,
        InternalServiceAuthGuard,
        KanbanProjectRepository,
        KanbanWorkItemRepository,
        KanbanProjectGoalRepository,
        KanbanOrchestrationRepository,
        KanbanCoreRunProjectionRepository,
        KanbanCoreLifecycleCursorRepository,
        KanbanCoreLifecycleDeadLetterRepository,
        ProjectService,
        ManagedProjectCloneService,
        ProjectMemorySummaryService,
        {
          provide: CharterRegenEnqueuer,
          useValue: { enqueue: vi.fn().mockResolvedValue(undefined) },
        },
        WorkItemService,
        KanbanLifecycleEventPublisher,
        {
          provide: WorkItemRealtimePublisher,
          useValue: { publish: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: WorkItemRealtimeGateway,
          useValue: { broadcastWorkItemUpdated: vi.fn() },
        },
        DispatchService,
        OrchestrationService,
        ProjectStrategicStateService,
        OrchestrationContinuationReconcilerService,
        ProjectOrchestrationWakeupService,
        {
          provide: OrchestrationLeaseService,
          useValue: {
            heartbeatCycleLease: vi.fn().mockResolvedValue(undefined),
          },
        },
        HumanDecisionResolutionPolicyService,
        KanbanEventDeliveryProjectionRepository,
        OrchestrationRepairLaneService,
        {
          provide: OrchestrationControlPlaneSchedulerService,
          useValue: {
            createIntent: vi.fn().mockResolvedValue({ id: "intent-test" }),
            evaluateIntent: vi.fn().mockResolvedValue({
              intentId: "intent-test",
              outcomeId: "outcome-test",
              status: "launchable",
              reason: "no_conflicts",
              conflictKeys: [],
              activeConflicts: [],
            }),
          },
        },
        {
          provide: KanbanRetrospectiveService,
          useValue: {
            runForCompletion: vi.fn(),
            runManualReplay: vi.fn(),
          },
        },
        {
          provide: KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
          useValue: {
            checkFailureThreshold: vi.fn().mockResolvedValue(undefined),
            resetConsecutiveFailureCount: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: KanbanSettingsService,
          useValue: {
            getNumber: vi.fn().mockResolvedValue(100),
          },
        },
        CoreRunProjectionService,
        PublishSpecsTool,
        KanbanMcpAuditService,
        KanbanMcpService,
        CoreLifecycleStreamConsumerService,
        {
          provide: CoreWorkflowClientService,
          useValue: coreClient,
        },
        {
          provide: CoreScopeClientService,
          useValue: { ensureProjectNode: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: KANBAN_REDIS_CLIENT,
          useValue: coreLifecycleRedis,
        },
        {
          provide: KANBAN_INTERNAL_TOOL_HANDLER,
          useFactory: (publishSpecsTool: PublishSpecsTool) => [
            publishSpecsTool,
          ],
          inject: [PublishSpecsTool],
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    baseUrl = await listenOnRandomPort(app);

    projectService = moduleRef.get(ProjectService);
    workItemService = moduleRef.get(WorkItemService);
    workItemsRepository = moduleRef.get(KanbanWorkItemRepository);
    projectGoals = moduleRef.get(KanbanProjectGoalRepository);
    runProjections = moduleRef.get(KanbanCoreRunProjectionRepository);
    orchestrationService = moduleRef.get(OrchestrationService);
    lifecycleConsumer = moduleRef.get(CoreLifecycleStreamConsumerService);
    reconciler = moduleRef.get(OrchestrationContinuationReconcilerService);
    mcpService = moduleRef.get(KanbanMcpService);
  }, TEST_TIMEOUT_MS);

  beforeEach(() => {
    tempDirs = [];
    vi.clearAllMocks();
    coreClient.requestWorkflowRun.mockImplementation((request) =>
      Promise.resolve({
        run_id:
          request.launch_source === "kanban_orchestration"
            ? `ceo-run-${coreClient.requestWorkflowRun.mock.calls.length.toString()}`
            : `work-item-run-${coreClient.requestWorkflowRun.mock.calls.length.toString()}`,
        workflow_id: request.workflow_id,
        status: "accepted",
        accepted_at: "2026-05-13T00:00:00.000Z",
        metadata: { correlation_id: "corr-epic-170" },
      }),
    );
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  afterAll(async () => {
    restoreEnv?.();
    await app?.close();
    await moduleRef?.close();
    await postgresContainer?.stop();
  }, TEST_TIMEOUT_MS);

  it(
    "recovers imported project orchestration through publish_specs, dispatch, projection, and blocked stale reconciliation",
    async () => {
      const projectBasePath = await mkdtemp(
        path.join(tmpdir(), "epic-170-imported-project-"),
      );
      tempDirs.push(projectBasePath);
      await writeWorkItemSpec(projectBasePath);

      const project = await projectService.create({
        name: "Imported Recovery Regression",
        description: "Imported repository bootstrap regression",
        sourceType: "import_local",
        basePath: projectBasePath,
        goals: [
          {
            title: "Recover imported repository orchestration",
            priority: "p0",
          },
        ],
      });

      expect(await projectGoals.findByproject_id(project.id)).toEqual([
        expect.objectContaining({
          project_id: project.id,
          title: "Recover imported repository orchestration",
          priority: "p0",
        }),
      ]);
      expect(await workItemService.listWorkItems(project.id)).toEqual([]);

      const publishResult = await mcpService.callTool(
        "kanban.publish_specs",
        {
          project_id: project.id,
          spec_directory: "docs/work-items",
        },
        { correlationId: "corr-epic-170", workflowRunId: "discovery-run-1" },
      );

      expect(publishResult).toEqual(
        expect.objectContaining({
          ok: true,
          created_count: 1,
          resolved_spec_directory: path.join(
            projectBasePath,
            "docs",
            "work-items",
          ),
        }),
      );

      const workItems = await workItemService.listWorkItems(project.id);
      expect(workItems).toEqual([
        expect.objectContaining({
          project_id: project.id,
          title: "Implement imported project recovery slice",
          status: "todo",
          metadata: expect.objectContaining({
            source: "publish_specs",
            sourceId: "WI-001",
          }),
        }),
      ]);

      const firstWorkItem = workItems[0];
      const dispatchResponse = await postJson(
        `${baseUrl}/projects/${project.id}/dispatch/selected-context-items`,
        {
          context_ids: [firstWorkItem.id],
          workflow_id: "work_item_in_progress_default",
          requested_by: "epic-170-regression",
        },
      );
      const dispatchBody = (await dispatchResponse.json()) as {
        success: boolean;
        data: { dispatched: Array<{ runId: string }> };
      };

      expect(dispatchResponse.ok).toBe(true);
      expect(dispatchBody.success).toBe(true);
      expect(dispatchBody.data.dispatched).toEqual([
        expect.objectContaining({
          workItemId: firstWorkItem.id,
          runId: "work-item-run-1",
          linkedRunId: "work-item-run-1",
          currentExecutionId: "work-item-run-1",
          status: "in-progress",
          mutationConfirmed: true,
        }),
      ]);

      const [updatedWorkItem] = await workItemService.listWorkItems(project.id);
      expect(updatedWorkItem).toEqual(
        expect.objectContaining({
          status: "in-progress",
          linkedRunId: "work-item-run-1",
          currentExecutionId: "work-item-run-1",
        }),
      );
      await expect(
        workItemsRepository.findByIds([firstWorkItem.id]),
      ).resolves.toEqual([
        expect.objectContaining({
          status: "in-progress",
          linked_run_id: "work-item-run-1",
          current_execution_id: "work-item-run-1",
        }),
      ]);

      const coreEventResponse = await postJson(
        `${baseUrl}/internal/core/events`,
        buildTerminalCoreRunEvent(project.id, firstWorkItem.id),
        { authorization: `Bearer ${KANBAN_SERVICE_TOKEN}` },
      );
      const coreEventBody = (await coreEventResponse.json()) as {
        success: boolean;
      };

      expect(coreEventResponse.ok).toBe(true);
      expect(coreEventBody.success).toBe(true);
      expect(await runProjections.findByRunId("work-item-run-1")).toEqual(
        expect.objectContaining({
          run_id: "work-item-run-1",
          project_id: project.id,
          work_item_id: firstWorkItem.id,
          status: "COMPLETED",
        }),
      );

      await orchestrationService.start(project.id, {
        goals: "Recover imported repository orchestration",
        orchestrationMode: "autonomous",
      });
      await orchestrationService.reconcileLinkedWorkflowRun(project.id, {
        workflowRunId: "ceo-run-2",
        status: "COMPLETED",
      });
      await orchestrationService.recordCycleDecision(project.id, {
        decision: "blocked",
        reason: "Human decision blocks imported repository continuation.",
        idempotencyKey: `blocked:${project.id}`,
      });

      const emittedDomainEventsBefore =
        coreClient.emitDomainEvent.mock.calls.length;
      const emittedCycleRequestsBefore = getCycleRequestsForProject(
        coreClient,
        project.id,
      ).length;
      coreLifecycleRedis.appendEnvelope(
        buildBlockedWorkItemTerminalCoreRunEvent(project.id, firstWorkItem.id),
      );
      await expect(
        lifecycleConsumer.replayFromCursor("blocked-auto-wakeup-regression"),
      ).resolves.toEqual({
        processed: 1,
        deadLettered: 0,
        lastStreamId: "1-0",
      });
      expect(
        await runProjections.findByRunId("blocked-work-item-run-1"),
      ).toEqual(
        expect.objectContaining({
          run_id: "blocked-work-item-run-1",
          project_id: project.id,
          work_item_id: firstWorkItem.id,
          status: "COMPLETED",
        }),
      );
      expect(getCycleRequestsForProject(coreClient, project.id)).toHaveLength(
        emittedCycleRequestsBefore,
      );

      await expect(reconciler.reconcileStaleContinuations()).resolves.toEqual({
        evaluated: 1,
      });
      await expect(reconciler.reconcileStaleContinuations()).resolves.toEqual({
        evaluated: 1,
      });
      expect(coreClient.emitDomainEvent).toHaveBeenCalledTimes(
        emittedDomainEventsBefore,
      );
      expect(getCycleRequestsForProject(coreClient, project.id)).toHaveLength(
        emittedCycleRequestsBefore,
      );
    },
    TEST_TIMEOUT_MS,
  );
  },
);

function createCoreClientMock(): CoreWorkflowClientMock {
  return {
    requestWorkflowRun: vi.fn(),
    getWorkflowRunStatus: vi.fn(),
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
    emitEventLedger: vi.fn().mockResolvedValue(undefined),
    cancelWorkflowRunsByScope: vi
      .fn()
      .mockResolvedValue({ cancelled_count: 0 }),
    retrieveSecret: vi.fn().mockResolvedValue("test-secret"),
    commitPaths: vi.fn().mockResolvedValue({
      committed: true,
      status: "committed",
      changed_files: [],
      commit_sha: "test-sha",
    }),
  };
}

async function writeWorkItemSpec(projectBasePath: string): Promise<void> {
  const specRoot = path.join(projectBasePath, "docs", "work-items");
  await mkdir(specRoot, { recursive: true });
  await writeFile(
    path.join(specRoot, "WI-001.md"),
    [
      "---",
      "item_id: WI-001",
      "title: Implement imported project recovery slice",
      "priority: p0",
      "scope: standard",
      "status: todo",
      "depends_on_item_ids: []",
      "---",
      "",
      "## Description",
      "Create the first canonical Kanban work item from imported project specs.",
    ].join("\n"),
  );
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function buildTerminalCoreRunEvent(projectId: string, workItemId: string) {
  return {
    event_id: "evt-terminal-imported-first-item",
    event_type: "core.workflow.run.completed.v1",
    event_version: "v1",
    occurred_at: "2026-05-13T00:01:00.000Z",
    correlation_id: "corr-epic-170",
    source_service: "core",
    payload: {
      run_id: "work-item-run-1",
      workflow_id: "work_item_in_progress_default",
      status: "COMPLETED",
      context: {
        scopeId: projectId,
        contextId: projectId,
        contextType: "kanban.project",
        metadata: { work_item_id: workItemId },
      },
    },
  };
}

function buildBlockedWorkItemTerminalCoreRunEvent(
  projectId: string,
  workItemId: string,
) {
  return {
    event_id: "evt-blocked-auto-wakeup-regression",
    event_type: "core.workflow.run.completed.v1",
    event_version: "v1",
    occurred_at: "2026-05-13T00:02:00.000Z",
    correlation_id: "corr-epic-170",
    source_service: "core",
    payload: {
      run_id: "blocked-work-item-run-1",
      workflow_id: "work_item_in_progress_default",
      status: "COMPLETED",
      context: {
        scopeId: projectId,
        contextId: null,
        contextType: "kanban.project",
        metadata: { work_item_id: workItemId },
      },
    },
  };
}
