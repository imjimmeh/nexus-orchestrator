/**
 * Integration tests for the strategic-refresh cycle endpoints added in EPIC-208.
 *
 * Surface: kanban-side controller tests (fallback from E2E).
 * Why fallback: the full E2E harness requires a running Docker stack that
 * includes built kanban images. The controller-level integration tests verify
 * the new endpoint wiring (POST /orchestration/cycle and GET /orchestration/timeline)
 * deterministically without requiring docker or a live LLM.
 *
 * Tests:
 *  1. POST /projects/:id/orchestration/cycle delegates to the wakeup service
 *     and returns the wakeup result.
 *  2. GET /projects/:id/orchestration/timeline returns the orchestration
 *     decision log as a flat timeline array.
 *  3. The initiatives LIST endpoint (GET /projects/:id/initiatives) returns
 *     the project's initiative list.
 */
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
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
import { OrchestrationController } from "../../src/orchestration/orchestration.controller";
import { OrchestrationActionRequestsController } from "../../src/orchestration/orchestration-action-requests.controller";
import { InitiativesController } from "../../src/initiatives/initiatives.controller";
import type { RequestWakeupResult } from "../../src/orchestration/project-orchestration-wakeup.types";
import { withEnv } from "./test-env";
import { listenOnRandomPort } from "./test-http";

// ── Minimal auth guard bypass ──────────────────────────────────────────────────
//
// The OrchestrationController uses KanbanPermissionsGuard and the
// initiatives controller has no auth guard — we only test the wiring here,
// not auth, so we skip the guard by not providing it (the controller spec
// approach used elsewhere in this test suite).

const jwtSecret = "test-secret-epic208";

function buildAdminJwt(): string {
  return jwt.sign(
    {
      sub: "00000000-e2e0-4000-a000-000000000001",
      role: "Admin",
      roles: ["Admin"],
    },
    jwtSecret,
    { expiresIn: "1h" },
  );
}

// ── Mock types ─────────────────────────────────────────────────────────────────

type MockOrchestrationService = {
  get: Mock;
  listWorkItems: Mock;
  listProjectActionRequests: Mock;
};

type MockWorkItemService = {
  listWorkItems: Mock;
};

type MockWakeupService = {
  requestWakeup: Mock<() => Promise<RequestWakeupResult>>;
};

type MockInitiativesService = {
  listInitiatives: Mock;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function triggerCycle(
  baseUrl: string,
  projectId: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/orchestration/cycle`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function getTimeline(
  baseUrl: string,
  projectId: string,
  token: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/orchestration/timeline`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function listInitiatives(
  baseUrl: string,
  projectId: string,
  token: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/initiatives`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("EPIC-208 strategic refresh: orchestration cycle + timeline endpoints", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let baseUrl: string;
  let orchestrationService: MockOrchestrationService;
  let workItemService: MockWorkItemService;
  let wakeupService: MockWakeupService;
  let token: string;

  beforeAll(async () => {
    restoreEnv = withEnv({
      JWT_SECRET: jwtSecret,
      KANBAN_SERVICE_JWT_AUDIENCE: "nexus-kanban-service",
      KANBAN_SERVICE_JWT_ISSUER: "nexus-api",
    });

    token = buildAdminJwt();

    orchestrationService = {
      get: vi.fn(),
      listWorkItems: vi.fn().mockResolvedValue([]),
      listProjectActionRequests: vi.fn().mockResolvedValue([]),
    };
    workItemService = {
      listWorkItems: vi.fn().mockResolvedValue([]),
    };
    wakeupService = {
      requestWakeup: vi
        .fn<() => Promise<RequestWakeupResult>>()
        .mockResolvedValue({
          emitted: true,
        }),
    };

    // We use the "OrchestrationService" token for the mock so NestJS injects it.
    const { OrchestrationService } =
      await import("../../src/orchestration/orchestration.service");
    const { WorkItemService } =
      await import("../../src/work-item/work-item.service");
    const { ProjectOrchestrationWakeupService } =
      await import("../../src/orchestration/project-orchestration-wakeup.service");
    const { OrchestrationPolicyService } =
      await import("../../src/orchestration/orchestration-policy.service");

    moduleRef = await Test.createTestingModule({
      controllers: [
        OrchestrationController,
        OrchestrationActionRequestsController,
      ],
      providers: [
        { provide: OrchestrationService, useValue: orchestrationService },
        { provide: WorkItemService, useValue: workItemService },
        { provide: ProjectOrchestrationWakeupService, useValue: wakeupService },
        {
          provide: OrchestrationPolicyService,
          useValue: { resolvePolicy: vi.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
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

  describe("POST /projects/:id/orchestration/cycle", () => {
    it("delegates to the wakeup service with provided reason", async () => {
      const projectId = "project-stale-1";

      const response = await triggerCycle(baseUrl, projectId, token, {
        reason: "e2e refresh",
      });

      expect(response.ok).toBe(true);
      const body = (await response.json()) as {
        success: boolean;
        data: RequestWakeupResult;
      };
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ emitted: true });

      expect(wakeupService.requestWakeup).toHaveBeenCalledWith({
        projectId,
        reason: "e2e refresh",
        source: "manual_trigger",
      });
    });

    it("uses default reason when body is empty", async () => {
      const projectId = "project-stale-2";

      const response = await triggerCycle(baseUrl, projectId, token);
      expect(response.ok).toBe(true);

      expect(wakeupService.requestWakeup).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          reason: "manual_trigger",
          source: "manual_trigger",
        }),
      );
    });

    it("returns emitted:false when an active cycle already exists", async () => {
      const projectId = "project-stale-3";
      wakeupService.requestWakeup.mockResolvedValueOnce({
        emitted: false,
        reason: "active_cycle_exists",
      });

      const response = await triggerCycle(baseUrl, projectId, token, {
        reason: "duplicate trigger",
      });
      expect(response.ok).toBe(true);
      const body = (await response.json()) as {
        success: boolean;
        data: RequestWakeupResult;
      };
      expect(body.data).toEqual({
        emitted: false,
        reason: "active_cycle_exists",
      });
    });
  });

  describe("GET /projects/:id/orchestration/timeline", () => {
    it("returns an empty array when the orchestration has no decision log", async () => {
      orchestrationService.get.mockResolvedValueOnce({
        id: "orch-1",
        project_id: "project-timeline-1",
        decisionLog: null,
      });

      const response = await getTimeline(baseUrl, "project-timeline-1", token);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as {
        success: boolean;
        data: unknown[];
      };
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it("returns decision log entries including strategic_intent entries", async () => {
      const strategicIntentEntry = {
        timestamp: "2026-06-13T00:00:00.000Z",
        type: "strategic_intent",
        reasoning: "e2e: rediscovery delegated",
        actions: ["deep_investigation", "roadmap_planning"],
        strategicIntent: {
          kind: "strategic_intent",
          focus_initiative_id: null,
          rationale: "merges over threshold",
          planned_next_steps: ["dispatch"],
          staleness_actions: ["deep_investigation"],
          created_at: "2026-06-13T00:00:00.000Z",
        },
      };
      orchestrationService.get.mockResolvedValueOnce({
        id: "orch-2",
        project_id: "project-timeline-2",
        decisionLog: [strategicIntentEntry],
      });

      const response = await getTimeline(baseUrl, "project-timeline-2", token);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as {
        success: boolean;
        data: unknown[];
      };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ type: "strategic_intent" });
    });

    it("returns an empty array when orchestration has not started", async () => {
      // getOrchestrationOrNull returns null when orchestration hasn't started
      const { NotFoundException } = await import("@nestjs/common");
      orchestrationService.get.mockRejectedValueOnce(
        new NotFoundException("not started"),
      );

      const response = await getTimeline(baseUrl, "project-not-started", token);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as {
        success: boolean;
        data: unknown[];
      };
      expect(body.data).toEqual([]);
    });
  });
});

describe("EPIC-208 strategic refresh: initiatives list endpoint", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let baseUrl: string;
  let initiativesService: MockInitiativesService;
  let token: string;

  beforeAll(async () => {
    restoreEnv = withEnv({
      JWT_SECRET: jwtSecret,
      KANBAN_SERVICE_JWT_AUDIENCE: "nexus-kanban-service",
      KANBAN_SERVICE_JWT_ISSUER: "nexus-api",
    });

    token = buildAdminJwt();

    initiativesService = {
      listInitiatives: vi.fn().mockResolvedValue([]),
    };

    const { InitiativesService } =
      await import("../../src/initiatives/initiatives.service");

    moduleRef = await Test.createTestingModule({
      controllers: [InitiativesController],
      providers: [
        { provide: InitiativesService, useValue: initiativesService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
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

  it("returns an empty list when no initiatives exist", async () => {
    const response = await listInitiatives(
      baseUrl,
      "project-no-initiatives",
      token,
    );
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      success: boolean;
      data: unknown[];
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(initiativesService.listInitiatives).toHaveBeenCalledWith(
      "project-no-initiatives",
    );
  });

  it("returns existing initiatives including now-horizon ones", async () => {
    const nowInitiative = {
      id: "init-1",
      project_id: "project-with-now",
      title: "Now initiative",
      description: null,
      horizon: "now",
      priority: 1,
      status: "active",
      goalIds: [],
      lastReviewedAt: null,
      created_at: "2026-06-13T00:00:00.000Z",
      updated_at: "2026-06-13T00:00:00.000Z",
    };
    initiativesService.listInitiatives.mockResolvedValueOnce([nowInitiative]);

    const response = await listInitiatives(baseUrl, "project-with-now", token);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      success: boolean;
      data: unknown[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      horizon: "now",
      title: "Now initiative",
    });
  });
});
