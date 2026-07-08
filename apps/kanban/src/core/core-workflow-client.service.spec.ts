import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { CoreWorkflowClientService } from "./core-workflow-client.service";

describe("CoreWorkflowClientService", () => {
  const previousBaseUrl = process.env.KANBAN_CORE_BASE_URL;
  const previousToken = process.env.KANBAN_CORE_BEARER_TOKEN;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousJwtAudience = process.env.KANBAN_CORE_JWT_AUDIENCE;
  const previousJwtIssuer = process.env.KANBAN_CORE_JWT_ISSUER;
  const previousJwtTtl = process.env.KANBAN_CORE_JWT_TTL;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.KANBAN_CORE_BASE_URL = "http://core.local:3010/api";
    process.env.KANBAN_CORE_BEARER_TOKEN = "secret-token";
    process.env.JWT_SECRET = "kanban-secret";
    process.env.KANBAN_CORE_JWT_AUDIENCE = "nexus-core-internal";
    process.env.KANBAN_CORE_JWT_ISSUER = "nexus-kanban";
    process.env.KANBAN_CORE_JWT_TTL = "5m";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.KANBAN_CORE_BASE_URL = previousBaseUrl;
    process.env.KANBAN_CORE_BEARER_TOKEN = previousToken;
    process.env.JWT_SECRET = previousJwtSecret;
    process.env.KANBAN_CORE_JWT_AUDIENCE = previousJwtAudience;
    process.env.KANBAN_CORE_JWT_ISSUER = previousJwtIssuer;
    process.env.KANBAN_CORE_JWT_TTL = previousJwtTtl;
  });

  it("resolves through Nest injection", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [KanbanCoreAuthTokenProvider, CoreWorkflowClientService],
    }).compile();

    expect(moduleRef.get(CoreWorkflowClientService)).toBeInstanceOf(
      CoreWorkflowClientService,
    );
  });

  it("sends workflow run requests to core internal endpoint with auth", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            run_id: "run-1",
            workflow_id: "wf-1",
            status: "accepted",
            accepted_at: "2026-04-13T00:00:00.000Z",
            metadata: { correlation_id: "corr-1" },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.requestWorkflowRun({
      workflow_id: "wf-1",
      input: { objective: "ship epic 91" },
      launch_source: "kanban_dispatch",
      context: {
        scopeId: "project-1",
        contextId: "project-1",
        contextType: "kanban.project",
        metadata: { workItemId: "work-item-1" },
      },
      metadata: {
        correlation_id: "corr-1",
      },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/internal/core/workflow-runs",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
      }),
    );
  });

  it("falls back to JWT service auth when static token is absent", async () => {
    process.env.KANBAN_CORE_BEARER_TOKEN = "";

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            run_id: "run-2",
            workflow_id: "wf-2",
            status: "accepted",
            accepted_at: "2026-04-13T00:05:00.000Z",
            metadata: { correlation_id: "corr-2" },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.requestWorkflowRun({
      workflow_id: "wf-2",
      input: { objective: "fallback jwt" },
      launch_source: "kanban_dispatch",
      metadata: {
        correlation_id: "corr-2",
      },
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const authHeader =
      (calledInit?.headers as Record<string, string>)?.authorization ?? null;

    expect(typeof authHeader).toBe("string");
    expect(authHeader?.startsWith("Bearer ")).toBe(true);
  });

  it("emits clone audit events to core event ledger with service auth", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const payload = {
      domain: "git",
      eventName: "git.clone.requested",
      outcome: "in_progress" as const,
      severity: "info" as const,
      source: "kanban.managed-clone",
      actorType: "system" as const,
      project_id: "11111111-1111-4111-8111-111111111111",
      workItemId: "22222222-2222-4222-8222-222222222222",
      correlation_id: "corr-clone-1",
      payload: {
        repositoryUrl: "https://github.com/acme/widget.git",
        targetPath: "G:/workspace/clones/project-1",
      },
    };

    const service = new CoreWorkflowClientService();
    await service.emitEventLedger(payload);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://core.local:3010/api/events/internal");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(JSON.stringify(payload));
  });

  it("sets workflow job output through the core runtime endpoint", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.setWorkflowJobOutput({
      workflowRunId: "run-1",
      jobId: "ceo_orchestration_decision",
      data: { decision: "repeat", decision_reason: "Safe repeat" },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/workflow-runtime/jobs/set-output",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(
      JSON.stringify({
        workflow_run_id: "run-1",
        job_id: "ceo_orchestration_decision",
        data: { decision: "repeat", decision_reason: "Safe repeat" },
      }),
    );
  });

  it("completes workflow steps through the core runtime step-complete endpoint", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.stepComplete({
      workflowRunId: "run-1",
      jobId: "ceo_orchestration_decision",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/workflow-runtime/step-complete",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(
      JSON.stringify({
        workflow_run_id: "run-1",
        job_id: "ceo_orchestration_decision",
      }),
    );
  });

  it("absorbs core event ledger emission failures", async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response("Core unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();

    await expect(
      service.emitEventLedger({
        domain: "git",
        eventName: "git.clone.failed",
        outcome: "failure",
        actorType: "system",
        project_id: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to emit Core event ledger entry: HTTP 503 Service Unavailable for event ledger emission",
    );
  });

  it("emits domain events to POST /internal/kanban/events", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { accepted: true } }),
          {
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.emitDomainEvent({
      eventName: "kanban.work_item.status_changed.v1",
      payload: {
        scopeId: "project-1",
        contextId: "work-item-1",
        status: "in-progress",
      },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://core.local:3010/api/internal/kanban/events");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(
      JSON.stringify({
        eventName: "kanban.work_item.status_changed.v1",
        payload: {
          scopeId: "project-1",
          contextId: "work-item-1",
          status: "in-progress",
        },
      }),
    );
  });

  it("emits domain events with fallback JWT when static token is absent", async () => {
    process.env.KANBAN_CORE_BEARER_TOKEN = "";

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    await service.emitDomainEvent({
      eventName: "kanban.work_item.status_changed.v1",
      payload: { scopeId: "project-1", contextId: "wi-1" },
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const authHeader =
      (calledInit?.headers as Record<string, string>)?.authorization ?? null;
    expect(typeof authHeader).toBe("string");
    expect(authHeader?.startsWith("Bearer ")).toBe(true);
    expect(calledInit?.body).toBe(
      JSON.stringify({
        eventName: "kanban.work_item.status_changed.v1",
        payload: { scopeId: "project-1", contextId: "wi-1" },
      }),
    );

    // Verify the fallback JWT with the test secret and assert serviceScopes
    const token = authHeader.replace("Bearer ", "");
    const verified = jwt.verify(token, "kanban-secret", {
      audience: "nexus-core-internal",
      issuer: "nexus-kanban",
    }) as Record<string, unknown>;
    expect(verified.serviceScopes).toContain("core.domain-events:write");
  });

  it("does not expose core project or work-item CRUD helpers", () => {
    const service = new CoreWorkflowClientService() as unknown as Record<
      string,
      unknown
    >;

    expect(service.listProjects).toBeUndefined();
    expect(service.getProject).toBeUndefined();
    expect(service.createProject).toBeUndefined();
    expect(service.getProjectMountPolicy).toBeUndefined();
    expect(service.listProjectWorkItems).toBeUndefined();
    expect(service.updateWorkItem).toBeUndefined();
    expect(service.updateWorkItemStatus).toBeUndefined();
    expect(service.restartWorkItemExecution).toBeUndefined();
    expect(service.getWorkItemExecutions).toBeUndefined();
    expect(service.getWorkItemExecutionConfig).toBeUndefined();
    expect(service.upsertWorkItemExecutionConfig).toBeUndefined();
    expect(service.getWorkItemAutomationStatuses).toBeUndefined();
  });

  it("surfaces non-2xx workflow run request failures", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response("Core rejected dispatch", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();

    vi.useFakeTimers();
    try {
      const rejection = expect(
        service.requestWorkflowRun({
          workflow_id: "wf-503",
          input: { objective: "fail" },
          launch_source: "kanban_dispatch",
          metadata: { correlation_id: "corr-503" },
        }),
      ).rejects.toThrow(
        "HTTP 503 Service Unavailable for http://core.local:3010/api/internal/core/workflow-runs",
      );
      await vi.runAllTimersAsync();
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("retrieves secret from internal API endpoint", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ secretValue: "ghp_testsecret123456789" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const secret = await service.retrieveSecret("secret-id-1");

    expect(secret).toBe("ghp_testsecret123456789");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/internal/secrets/retrieve",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(JSON.stringify({ secretId: "secret-id-1" }));
  });

  it("surfaces non-2xx secret retrieval failures", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response("Secret not found", {
          status: 404,
          statusText: "Not Found",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();

    await expect(service.retrieveSecret("missing-secret")).rejects.toThrow(
      "HTTP 404 Not Found for secret retrieval",
    );
  });

  it("falls back to JWT service auth for secret retrieval when static token is absent", async () => {
    process.env.KANBAN_CORE_BEARER_TOKEN = "";

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ secretValue: "jwt-retrieved-secret" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const secret = await service.retrieveSecret("secret-id-2");

    expect(secret).toBe("jwt-retrieved-secret");
    const [, calledInit] = fetchMock.mock.calls[0];
    const authHeader =
      (calledInit?.headers as Record<string, string>)?.authorization ?? null;
    expect(typeof authHeader).toBe("string");
    expect(authHeader?.startsWith("Bearer ")).toBe(true);
  });

  it("calls repository workflow refresh endpoint with correct URL and body", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            discovered: 3,
            upserted: 3,
            disabled: 0,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.refreshRepositoryWorkflows({
      scopeId: "scope-1",
      rootPath: "/repos/project-1",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/workflows/repository/refresh",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(
      JSON.stringify({
        scopeId: "scope-1",
        rootPath: "/repos/project-1",
      }),
    );
    expect(result).toEqual({
      discovered: 3,
      upserted: 3,
      disabled: 0,
    });
  });

  it("calls repository workflow refresh with optional sourceRef", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            discovered: 2,
            upserted: 1,
            disabled: 1,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.refreshRepositoryWorkflows({
      scopeId: "scope-2",
      rootPath: "/repos/project-2",
      sourceRef: "main",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/workflows/repository/refresh",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.body).toBe(
      JSON.stringify({
        scopeId: "scope-2",
        rootPath: "/repos/project-2",
        sourceRef: "main",
      }),
    );
    expect(result).toEqual({
      discovered: 2,
      upserted: 1,
      disabled: 1,
    });
  });

  it("lists repository branches through the core git endpoint", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ branches: ["main"] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.listRepositoryBranches({ repoPath: "/repo" });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://core.local:3010/api/git/branches/list");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.body).toBe(JSON.stringify({ repoPath: "/repo" }));
    expect(result).toEqual({ branches: ["main"] });
  });

  it("lists repository tracked files through the core git endpoint", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ files: ["README.md"] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.listRepositoryTrackedFiles({
      repoPath: "/repo",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://core.local:3010/api/git/tracked-files/list");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.body).toBe(JSON.stringify({ repoPath: "/repo" }));
    expect(result).toEqual({ files: ["README.md"] });
  });

  it("shows repository files through the core git endpoint", async () => {
    const fileContent = {
      content: "# Repository",
      path: "README.md",
      branch: "main",
      size: 12,
    };
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify(fileContent), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.showRepositoryFile({
      repoPath: "/repo",
      filePath: "README.md",
      ref: "main",
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://core.local:3010/api/git/files/show");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.body).toBe(
      JSON.stringify({ repoPath: "/repo", filePath: "README.md", ref: "main" }),
    );
    expect(result).toEqual(fileContent);
  });

  it("surfaces network failures from workflow run requests", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();

    vi.useFakeTimers();
    try {
      const rejection = expect(
        service.requestWorkflowRun({
          workflow_id: "wf-network",
          input: { objective: "fail" },
          launch_source: "kanban_dispatch",
          metadata: { correlation_id: "corr-network" },
        }),
      ).rejects.toThrow("connect ECONNREFUSED");
      await vi.runAllTimersAsync();
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls lifecycle execution endpoint with correct URL and body", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "result-1",
            scopeId: "scope-1",
            phase: "merge",
            hook: "before",
            blockingOnly: true,
            status: "passed",
            results: [],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new CoreWorkflowClientService();
    const result = await service.executeLifecycleWorkflows({
      scopeId: "scope-1",
      contextId: "ctx-1",
      phase: "merge",
      hook: "before",
      blockingOnly: true,
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "http://core.local:3010/api/workflows/lifecycle/execute",
    );
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      }),
    );
    expect(calledInit?.body).toBe(
      JSON.stringify({
        scopeId: "scope-1",
        contextId: "ctx-1",
        phase: "merge",
        hook: "before",
        blockingOnly: true,
      }),
    );
    expect(result).toEqual({
      id: "result-1",
      scopeId: "scope-1",
      phase: "merge",
      hook: "before",
      blockingOnly: true,
      status: "passed",
      results: [],
    });
  });
});
