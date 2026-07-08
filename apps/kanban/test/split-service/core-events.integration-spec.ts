import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { CoreWorkflowRunEventEnvelopeV1Shape } from "@nexus/core";
import jwt from "jsonwebtoken";
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
import type { CoreRunProjection } from "../../src/core/core-run-projection.types";
import { withEnv } from "./test-env";
import { listenOnRandomPort } from "./test-http";

type MockCoreRunProjectionService = {
  recordCoreLifecycleEvent: Mock<
    (event: CoreWorkflowRunEventEnvelopeV1Shape) => Promise<CoreRunProjection>
  >;
  getProjection: Mock<() => Promise<unknown>>;
  listByProject: Mock<() => Promise<unknown>>;
};

type MockCoreLifecycleStreamConsumerService = {
  replayFromCursor: Mock<() => Promise<unknown>>;
  getDiagnostics: Mock<() => Promise<unknown>>;
};

const validEnvelope = {
  event_id: "evt-1",
  event_type: "core.workflow.run.status_changed.v1",
  event_version: "v1",
  occurred_at: "2026-04-30T00:00:00.000Z",
  correlation_id: "corr-1",
  source_service: "core",
  payload: {
    run_id: "run-1",
    workflow_id: "wf-1",
    status: "RUNNING",
    context: {
      scopeId: "project-1",
      contextId: "project-1",
      contextType: "kanban.project",
      metadata: { workItemId: "work-item-1" },
    },
  },
} satisfies CoreWorkflowRunEventEnvelopeV1Shape;

const projectedRun = {
  runId: "run-1",
  workflowId: "wf-1",
  status: "RUNNING",
  project_id: "project-1",
  workItemId: "work-item-1",
  occurredAt: "2026-04-30T00:00:00.000Z",
  lastEventId: "evt-1",
  lastEventType: "core.workflow.run.status_changed.v1",
} satisfies CoreRunProjection;

const jwtSecret = "test-secret";

async function postCoreLifecycleEvent(
  baseUrl: string,
  authorization?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/internal/core/events`, {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(validEnvelope),
  });
}

function signServiceJwt(serviceScopes: string[]): string {
  return jwt.sign(
    {
      role: "agent",
      roles: ["Admin", "Developer"],
      service: "core",
      serviceScopes,
    },
    jwtSecret,
    {
      subject: "core-service",
      audience: "nexus-kanban-service",
      issuer: "nexus-api",
      expiresIn: "1h",
    },
  );
}

describe("CoreEventsController split-service integration", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let baseUrl: string;
  let projectionService: MockCoreRunProjectionService;
  let lifecycleConsumer: MockCoreLifecycleStreamConsumerService;

  beforeAll(async () => {
    restoreEnv = withEnv({
      KANBAN_SERVICE_BEARER_TOKEN: "kanban-internal-token",
      JWT_SECRET: jwtSecret,
      KANBAN_SERVICE_JWT_AUDIENCE: "nexus-kanban-service",
      KANBAN_SERVICE_JWT_ISSUER: "nexus-api",
    });

    projectionService = {
      recordCoreLifecycleEvent: vi
        .fn<
          (
            event: CoreWorkflowRunEventEnvelopeV1Shape,
          ) => Promise<CoreRunProjection>
        >()
        .mockResolvedValue(projectedRun),
      getProjection: vi.fn<() => Promise<unknown>>(),
      listByProject: vi.fn<() => Promise<unknown>>(),
    };
    lifecycleConsumer = {
      replayFromCursor: vi.fn<() => Promise<unknown>>(),
      getDiagnostics: vi.fn<() => Promise<unknown>>(),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [CoreEventsController],
      providers: [
        InternalServiceAuthGuard,
        { provide: CoreRunProjectionService, useValue: projectionService },
        {
          provide: CoreLifecycleStreamConsumerService,
          useValue: lifecycleConsumer,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    baseUrl = await listenOnRandomPort(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    restoreEnv?.();
    await app?.close();
    await moduleRef?.close();
  });

  it("rejects Core lifecycle envelopes without authorization", async () => {
    const response = await postCoreLifecycleEvent(baseUrl);

    expect(response.ok).toBe(false);
    expect(projectionService.recordCoreLifecycleEvent).not.toHaveBeenCalled();
  });

  it("rejects Core lifecycle envelopes with the wrong static token", async () => {
    const response = await postCoreLifecycleEvent(
      baseUrl,
      "Bearer wrong-token",
    );

    expect(response.ok).toBe(false);
    expect(projectionService.recordCoreLifecycleEvent).not.toHaveBeenCalled();
  });

  it("accepts Core lifecycle envelopes with the valid static token", async () => {
    const response = await postCoreLifecycleEvent(
      baseUrl,
      "Bearer kanban-internal-token",
    );

    const body = (await response.json()) as unknown;

    expect(response.ok).toBe(true);
    expect(body).toEqual({ success: true, data: projectedRun });
    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
    const recordedEnvelope =
      projectionService.recordCoreLifecycleEvent.mock.calls[0]?.[0];
    expect(recordedEnvelope?.event_id).toBe("evt-1");
    expect(recordedEnvelope?.correlation_id).toBe("corr-1");
    expect(recordedEnvelope?.payload.run_id).toBe("run-1");
    expect(recordedEnvelope?.payload.context?.contextId).toBe("project-1");
    expect(recordedEnvelope?.payload.context?.contextType).toBe(
      "kanban.project",
    );
    expect(recordedEnvelope?.payload.context?.metadata?.workItemId).toBe(
      "work-item-1",
    );
  });

  it("accepts Core lifecycle envelopes with a JWT carrying the write scope", async () => {
    const token = signServiceJwt(["kanban.core-events:write"]);
    const response = await postCoreLifecycleEvent(baseUrl, `Bearer ${token}`);

    const body = (await response.json()) as unknown;

    expect(response.ok).toBe(true);
    expect(body).toEqual({ success: true, data: projectedRun });
    expect(projectionService.recordCoreLifecycleEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects Core lifecycle envelopes when the JWT only carries the read scope", async () => {
    const token = signServiceJwt(["kanban.core-events:read"]);
    const response = await postCoreLifecycleEvent(baseUrl, `Bearer ${token}`);

    expect(response.ok).toBe(false);
    expect(projectionService.recordCoreLifecycleEvent).not.toHaveBeenCalled();
  });
});
