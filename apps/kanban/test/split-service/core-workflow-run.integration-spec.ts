import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
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
import type { WorkflowRunAcceptedV1, WorkflowRunRequestV1 } from "@nexus/core";
import { WorkflowInternalCoreRunsController } from "../../../api/src/workflow/workflow-internal-core-runs.controller";
import { WorkflowInternalCoreRunsService } from "../../../api/src/workflow/workflow-internal-core-runs.service";
import { InternalServiceScopeGuard } from "../../../api/src/auth/internal-service-scope.guard";
import { JwtAuthGuard } from "../../../api/src/auth/jwt-auth.guard";
import { PermissionsGuard } from "../../../api/src/auth/authorization/permissions.guard";
import { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import { withEnv } from "./test-env";
import { listenOnRandomPort } from "./test-http";

const jwtSecret = "kanban-core-integration-secret";

// PermissionsGuard now lives upstream on the migrated controller; this
// minimal API app does not stand up the real AuthorizationService /
// EnforcementModeService wiring, so we let the guard pass through for
// the integration test, which focuses on client wiring and authorization
// already covered by InternalServiceScopeGuard + JwtAuthGuard.
const allowAllGuard: CanActivate = { canActivate: () => true };

type MockCoreRunsService = {
  requestWorkflowRun: Mock<
    (request: WorkflowRunRequestV1) => Promise<WorkflowRunAcceptedV1>
  >;
  getWorkflowRunStatus: Mock<() => Promise<unknown>>;
  controlWorkflowRun: Mock<() => Promise<unknown>>;
};

const jwtAuthGuardOverride: CanActivate = {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string | string[] };
      user?: { roles: string[] };
    }>();
    if (!hasBearerAuthorization(request.headers.authorization)) {
      return false;
    }

    request.user = { roles: ["Admin", "Developer"] };
    return true;
  },
};

function hasBearerAuthorization(
  header: string | string[] | undefined,
): boolean {
  if (typeof header !== "string") {
    return false;
  }

  return /^Bearer\s+\S+/i.test(header.trim());
}

describe("CoreWorkflowClientService workflow run integration", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let coreRunsService: MockCoreRunsService;

  beforeAll(async () => {
    coreRunsService = {
      requestWorkflowRun: vi
        .fn<(request: WorkflowRunRequestV1) => Promise<WorkflowRunAcceptedV1>>()
        .mockResolvedValue({
          run_id: "run-1",
          workflow_id: "wf-1",
          status: "accepted",
          accepted_at: "2026-04-30T00:00:00.000Z",
          metadata: { correlation_id: "corr-1" },
        } satisfies WorkflowRunAcceptedV1),
      getWorkflowRunStatus: vi.fn<() => Promise<unknown>>(),
      controlWorkflowRun: vi.fn<() => Promise<unknown>>(),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [WorkflowInternalCoreRunsController],
      providers: [
        InternalServiceScopeGuard,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === "JWT_SECRET" ? jwtSecret : undefined,
            ),
          },
        },
        {
          provide: WorkflowInternalCoreRunsService,
          useValue: coreRunsService,
        },
      ],
    })
      // The full Passport JWT strategy is outside this minimal API app; this override
      // keeps role hydration focused while InternalServiceScopeGuard verifies the token.
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtAuthGuardOverride)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    const apiBaseUrl = await listenOnRandomPort(app);
    const token = jwt.sign(
      {
        role: "agent",
        roles: ["Admin", "Developer"],
        service: "kanban",
        serviceScopes: ["core.workflow-runs:read", "core.workflow-runs:write"],
      },
      jwtSecret,
      {
        subject: "kanban-service",
        audience: "nexus-core-internal",
        issuer: "nexus-kanban",
        expiresIn: "1h",
      },
    );

    restoreEnv = withEnv({
      KANBAN_CORE_BASE_URL: `${apiBaseUrl}/api`,
      KANBAN_CORE_BEARER_TOKEN: token,
      JWT_SECRET: undefined,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    restoreEnv?.();
    await app?.close();
    await moduleRef?.close();
  });

  it("rejects workflow run requests without authorization", async () => {
    const restoreMissingAuthEnv = withEnv({
      KANBAN_CORE_BEARER_TOKEN: undefined,
      JWT_SECRET: undefined,
    });
    const client = new CoreWorkflowClientService();

    try {
      await expect(
        client.requestWorkflowRun({
          workflow_id: "wf-1",
          input: { objective: "ship split service" },
          launch_source: "kanban_dispatch",
          metadata: { correlation_id: "corr-1" },
        }),
      ).rejects.toThrow();
      expect(coreRunsService.requestWorkflowRun).not.toHaveBeenCalled();
    } finally {
      restoreMissingAuthEnv();
    }
  });

  it("requests a workflow run through the API internal route and preserves context", async () => {
    const client = new CoreWorkflowClientService();
    const request: WorkflowRunRequestV1 = {
      workflow_id: "wf-1",
      input: { objective: "ship split service" },
      launch_source: "kanban_dispatch",
      context: {
        scopeId: "project-1",
        contextId: "project-1",
        contextType: "kanban.project",
        metadata: { workItemId: "work-item-1" },
      },
      metadata: { correlation_id: "corr-1" },
    };

    const result = await client.requestWorkflowRun(request);

    expect(result).toMatchObject({
      run_id: "run-1",
      workflow_id: "wf-1",
      status: "accepted",
      accepted_at: "2026-04-30T00:00:00.000Z",
      metadata: { correlation_id: "corr-1" },
    });
    expect(coreRunsService.requestWorkflowRun).toHaveBeenCalledTimes(1);
    const forwardedRequest =
      coreRunsService.requestWorkflowRun.mock.calls[0]?.[0];
    expect(forwardedRequest?.context?.contextId).toBe("project-1");
    expect(forwardedRequest?.context?.contextType).toBe("kanban.project");
    expect(forwardedRequest?.context?.metadata?.workItemId).toBe("work-item-1");
  });
});
