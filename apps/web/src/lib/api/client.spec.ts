import { beforeEach, describe, expect, it, vi } from "vitest";
import type { api as apiClientSingleton } from "./client";
import type { CreateMcpServerRequest } from "./mcp.types";

type ApiClientTestClient = typeof apiClientSingleton;

type RequestConfig = {
  url?: string;
  method?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  _retry?: boolean;
};

type ResponseError = {
  response?: { status?: number };
  config?: RequestConfig;
};

type StorageMap = Record<string, string>;

const mockAxiosPost = vi.fn();
let requestInterceptor: ((config: RequestConfig) => RequestConfig) | undefined;
let responseErrorInterceptor:
  | ((error: ResponseError) => Promise<unknown>)
  | undefined;

const mockAxiosClient = Object.assign(vi.fn(), {
  interceptors: {
    request: {
      use: vi.fn((onFulfilled: (config: RequestConfig) => RequestConfig) => {
        requestInterceptor = onFulfilled;
        return 0;
      }),
    },
    response: {
      use: vi.fn(
        (
          _onFulfilled: (response: unknown) => unknown,
          onRejected: (error: ResponseError) => Promise<unknown>,
        ) => {
          responseErrorInterceptor = onRejected;
          return 0;
        },
      ),
    },
  },
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
});

vi.mock("axios", () => ({
  __esModule: true,
  default: {
    create: vi.fn(() => mockAxiosClient),
    post: mockAxiosPost,
  },
}));

function createLocalStorage(storage: StorageMap) {
  return {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      Reflect.deleteProperty(storage, key);
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(storage)) {
        Reflect.deleteProperty(storage, key);
      }
    }),
  };
}

describe("ApiClient auth handling", () => {
  let storage: StorageMap;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requestInterceptor = undefined;
    responseErrorInterceptor = undefined;
    storage = {};

    const localStorageMock = createLocalStorage(storage);

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: localStorageMock,
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
  });

  it("adds Authorization header from nexus_token", async () => {
    storage.nexus_token = "direct-access-token";
    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const config = requestInterceptor?.({ headers: {} });

    expect(apiClient).toBeDefined();
    expect(config?.headers?.Authorization).toBe("Bearer direct-access-token");
  }, 15_000);

  it("falls back to persisted auth storage token when nexus_token is missing", async () => {
    storage["nexus-auth-storage"] = JSON.stringify({
      state: {
        accessToken: "persisted-access-token",
        refreshToken: "persisted-refresh-token",
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as InstanceType<typeof ApiClient> & {
      getProjects: () => Promise<Array<Record<string, unknown>>>;
    };

    const config = requestInterceptor?.({ headers: {} });

    expect(apiClient).toBeDefined();
    expect(config?.headers?.Authorization).toBe(
      "Bearer persisted-access-token",
    );
  });

  it("does not attach malformed token values", async () => {
    storage.nexus_token = "undefined";

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const config = requestInterceptor?.({ headers: {} });

    expect(apiClient).toBeDefined();
    expect(config?.headers?.Authorization).toBeUndefined();
  });

  it("parses nested refresh response and updates stored tokens", async () => {
    storage["nexus-auth-storage"] = JSON.stringify({
      state: {
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
      },
    });

    mockAxiosClient.mockResolvedValueOnce({ data: { data: { ok: true } } });
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
          expiresIn: 3600,
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await responseErrorInterceptor?.({
      response: { status: 401 },
      config: { baseURL: "/api", headers: {} },
    });

    expect(apiClient).toBeDefined();
    expect(mockAxiosPost).toHaveBeenCalledWith("/api/auth/refresh", {
      refreshToken: "old-refresh-token",
    });
    expect(storage.nexus_token).toBe("new-access-token");

    const persisted = JSON.parse(storage["nexus-auth-storage"]);
    expect(persisted.state.accessToken).toBe("new-access-token");
    expect(persisted.state.refreshToken).toBe("new-refresh-token");
  });

  it("clears auth storage when refresh flow fails", async () => {
    storage.nexus_token = "stale-token";
    storage["nexus-auth-storage"] = JSON.stringify({
      state: {
        accessToken: "stale-token",
        refreshToken: "stale-refresh",
      },
    });

    mockAxiosPost.mockRejectedValueOnce(new Error("refresh failed"));

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await expect(
      responseErrorInterceptor?.({
        response: { status: 401 },
        config: { baseURL: "/api", headers: {} },
      }),
    ).rejects.toThrow("refresh failed");

    expect(apiClient).toBeDefined();
    expect(storage.nexus_token).toBeUndefined();
    expect(storage["nexus-auth-storage"]).toBeUndefined();
  });
});

describe("ApiClient service-aware routing", () => {
  let storage: StorageMap;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requestInterceptor = undefined;
    responseErrorInterceptor = undefined;
    storage = {};

    const localStorageMock = createLocalStorage(storage);

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: {
          apiUrl: "/api",
          coreApiUrl: "/core-api",
          kanbanApiUrl: "/kanban-api",
          chatApiUrl: "/chat-api",
        },
        localStorage: localStorageMock,
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
  });

  it("routes kanban, chat, and core requests to service-specific base URLs", async () => {
    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const projectConfig = requestInterceptor?.({
      url: "/projects",
      headers: {},
    });
    const chatConfig = requestInterceptor?.({
      url: "/sessions/chat",
      headers: {},
    });
    const coreConfig = requestInterceptor?.({
      url: "/workflows/runs",
      headers: {},
    });
    const projectDeleteConfig = requestInterceptor?.({
      url: "/projects/project-1",
      method: "delete",
      headers: {},
    });
    const workItemConfig = requestInterceptor?.({
      url: "/work-items",
      headers: {},
    });
    const projectWorkItemsConfig = requestInterceptor?.({
      url: "/projects/project-1/work-items",
      headers: {},
    });
    const projectGoalsConfig = requestInterceptor?.({
      url: "/projects/project-1/goals",
      headers: {},
    });
    const orchestrationConfig = requestInterceptor?.({
      url: "/orchestration/action-requests",
      headers: {},
    });
    const warRoomConfig = requestInterceptor?.({
      url: "/projects/project-1/orchestration/war-room/sessions",
      headers: {},
    });

    expect(apiClient).toBeDefined();
    expect(projectConfig?.baseURL).toBe("/kanban-api");
    expect(chatConfig?.baseURL).toBe("/chat-api");
    expect(coreConfig?.baseURL).toBe("/core-api");
    expect(projectDeleteConfig?.baseURL).toBe("/kanban-api");
    expect(workItemConfig?.baseURL).toBe("/kanban-api");
    expect(projectWorkItemsConfig?.baseURL).toBe("/kanban-api");
    expect(projectGoalsConfig?.baseURL).toBe("/kanban-api");
    expect(orchestrationConfig?.baseURL).toBe("/kanban-api");
    expect(warRoomConfig?.baseURL).toBe("/core-api");
  });

  it("refreshes tokens against core API even when a chat request fails with 401", async () => {
    storage["nexus-auth-storage"] = JSON.stringify({
      state: {
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
      },
    });

    mockAxiosClient.mockResolvedValueOnce({ data: { data: { ok: true } } });
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
          expiresIn: 3600,
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await responseErrorInterceptor?.({
      response: { status: 401 },
      config: {
        url: "/sessions/chat",
        baseURL: "/chat-api",
        headers: {},
      },
    });

    expect(apiClient).toBeDefined();
    expect(mockAxiosPost).toHaveBeenCalledWith("/core-api/auth/refresh", {
      refreshToken: "old-refresh-token",
    });
  });

  it("does not expose core project steering plan endpoints", async () => {
    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as InstanceType<typeof ApiClient> &
      Record<string, unknown>;

    expect(apiClient.createSteeringPlan).toBeUndefined();
    expect(apiClient.getSteeringPlan).toBeUndefined();
    expect(apiClient.approveSteeringPlan).toBeUndefined();
    expect(apiClient.rejectSteeringPlan).toBeUndefined();
  });
});

describe("ApiClient workflow telemetry methods", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
  });

  it("getWorkflowRunEvents returns telemetry event list", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            event_type: "turn_end",
            timestamp: "2026-03-24T00:00:00.000Z",
            payload: { stepId: "step-1" },
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowRunEvents("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/events",
    );
    expect(result).toEqual([
      {
        event_type: "turn_end",
        timestamp: "2026-03-24T00:00:00.000Z",
        payload: { stepId: "step-1" },
      },
    ]);
  });

  it("getWorkflowRunAutonomyDiagnostics returns run autonomy diagnostics", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              category: "repair",
              title:
                "Repair delegation: doctor.runtime_artifact.refresh_stale_artifacts",
              status: "in_progress",
              summary:
                "Policy action: doctor.runtime_artifact.refresh_stale_artifacts. Execution path: doctor. Attempt: 1",
              evidence: [],
              nextSteps: [],
            },
          ],
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowRunAutonomyDiagnostics("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/autonomy/diagnostics",
      undefined,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.category).toBe("repair");
  });

  it("getWorkflowEvents maps project-scoped UI queries to neutral scopeId", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "event-1",
            workflow_run_id: "run-1",
            event_type: "turn_end",
            step_id: "step-1",
            payload: { stepId: "step-1" },
            timestamp: "2026-03-24T00:00:00.000Z",
          },
        ],
        meta: {
          pagination: {
            total: 42,
            limit: 25,
            offset: 0,
          },
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowEvents({
      projectId: "project-1",
      limit: 25,
      offset: 0,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/workflows/events", {
      params: {
        scopeId: "project-1",
        limit: "25",
        offset: "0",
      },
    });
    expect(result).toEqual({
      data: [
        {
          id: "event-1",
          workflow_run_id: "run-1",
          event_type: "turn_end",
          step_id: "step-1",
          payload: { stepId: "step-1" },
          timestamp: "2026-03-24T00:00:00.000Z",
        },
      ],
      total: 42,
      limit: 25,
      offset: 0,
    });
  });

  it("getEventLedger returns paginated event ledger results", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "ledger-1",
            domain: "git",
            event_name: "git.branch.push.succeeded",
            outcome: "success",
            severity: "info",
            source: "api",
            project_id: "project-1",
            payload: { branchName: "main" },
            occurred_at: "2026-03-24T00:00:00.000Z",
          },
        ],
        meta: {
          total: 1,
          limit: 10,
          offset: 0,
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getEventLedger({
      projectId: "project-1",
      domain: "git",
      outcome: "success",
      severity: "info",
      search: "branch",
      sortBy: "occurred_at",
      sortDir: "asc",
      limit: 10,
      offset: 0,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/events", {
      params: {
        projectId: "project-1",
        domain: "git",
        outcome: "success",
        severity: "info",
        search: "branch",
        sortBy: "occurred_at",
        sortDir: "asc",
        limit: "10",
        offset: "0",
      },
    });
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: "ledger-1",
          event_name: "git.branch.push.succeeded",
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
  });

  it("getWorkflowRunTelemetryAuth returns websocket token payload", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          token: "ws-jwt-token",
          wsUrl: "http://127.0.0.1:3001",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowRunTelemetryAuth("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/telemetry-auth",
      undefined,
    );
    expect(result).toEqual({
      token: "ws-jwt-token",
      wsUrl: "http://127.0.0.1:3001",
    });
  });

  it("getWorkflowRunGraph returns run graph snapshot", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          workflowId: "workflow-1",
          workflowRunId: "run-1",
          runStatus: "RUNNING",
          nodes: [],
          edges: [],
          activeNodeIds: [],
          queuedNodeIds: [],
          completedNodeIds: [],
          failedNodeIds: [],
          cursor: {
            latestEventAt: null,
            totalEvents: 0,
          },
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowRunGraph("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/graph",
      undefined,
    );
    expect(result.workflowRunId).toBe("run-1");
  });

  it("getWorkflowGraph returns static graph snapshot", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          workflowId: "workflow-1",
          workflowRunId: null,
          runStatus: null,
          nodes: [],
          edges: [],
          activeNodeIds: [],
          queuedNodeIds: [],
          completedNodeIds: [],
          failedNodeIds: [],
          cursor: {
            latestEventAt: null,
            totalEvents: 0,
          },
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowGraph("workflow-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/workflow-1/graph",
      undefined,
    );
    expect(result.workflowId).toBe("workflow-1");
    expect(result.workflowRunId).toBeNull();
  });

  it("getWorkflowRuns requests run list without params when no filters are provided", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.getWorkflowRuns();

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/workflows/runs", {
      params: undefined,
    });
  });

  it("getWorkflows fetches all definitions without exceeding the workflow API limit", async () => {
    const workflows = Array.from({ length: 101 }, (_, index) => ({
      id: `workflow-${index + 1}`,
      name: `Workflow ${index + 1}`,
      yaml_definition: "name: test",
      is_active: true,
    }));

    mockAxiosClient.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: workflows.slice(0, 100),
          meta: { pagination: { total: 101, limit: 100, offset: 0 } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: workflows.slice(100),
          meta: { pagination: { total: 101, limit: 100, offset: 100 } },
        },
      });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflows();

    expect(result).toHaveLength(101);
    expect(mockAxiosClient.get).toHaveBeenNthCalledWith(1, "/workflows", {
      params: { limit: "100", offset: "0" },
    });
    expect(mockAxiosClient.get).toHaveBeenNthCalledWith(2, "/workflows", {
      params: { limit: "100", offset: "100" },
    });
  });

  it("getWorkflowsPage returns workflow table pages with offset pagination", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "workflow-1",
            name: "Workflow 1",
            yaml_definition: "name: test",
            is_active: true,
          },
        ],
        meta: { pagination: { total: 42, limit: 20, offset: 40 } },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowsPage({
      limit: 20,
      offset: 40,
      search: "triage",
      sortBy: "created_at",
      sortDir: "desc",
      includeInactive: false,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/workflows", {
      params: {
        limit: "20",
        offset: "40",
        search: "triage",
        sortBy: "created_at",
        sortDir: "desc",
        includeInactive: "false",
      },
    });
    expect(result.meta?.pagination?.total).toBe(42);
  });

  it("getProvidersPage preserves paginated provider metadata", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "provider-1",
            name: "OpenAI",
            auth_type: "api_key",
            runtime_env: {},
            is_active: true,
            created_at: "2026-03-24T00:00:00.000Z",
            updated_at: "2026-03-24T00:00:00.000Z",
          },
        ],
        meta: { pagination: { total: 7, page: 2, limit: 5, totalPages: 2 } },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getProvidersPage({
      page: 2,
      limit: 5,
      search: "open",
      sortBy: "auth_type",
      sortDir: "asc",
      isActive: true,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/ai-config/providers", {
      params: {
        page: "2",
        limit: "5",
        search: "open",
        sortBy: "auth_type",
        sortDir: "asc",
        isActive: "true",
      },
    });
    expect(result.meta?.pagination?.total).toBe(7);
  });

  it("getModelsPage preserves paginated model metadata", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "model-1",
            name: "gpt-test",
            provider_name: "OpenAI",
            token_limit: 128000,
            default_for_execution: false,
            default_for_distillation: false,
            default_for_summarization: false,
            default_for_session: false,
            is_active: true,
            created_at: "2026-03-24T00:00:00.000Z",
            updated_at: "2026-03-24T00:00:00.000Z",
          },
        ],
        meta: { pagination: { total: 9, page: 1, limit: 10, totalPages: 1 } },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getModelsPage({
      page: 1,
      limit: 10,
      search: "gpt",
      sortBy: "provider_name",
      sortDir: "desc",
      isActive: false,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/ai-config/models", {
      params: {
        page: "1",
        limit: "10",
        search: "gpt",
        sortBy: "provider_name",
        sortDir: "desc",
        isActive: "false",
      },
    });
    expect(result.meta?.pagination?.total).toBe(9);
  });

  it("getWorkflowRuns maps UI scope aliases to neutral workflow run filters", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.getWorkflowRuns({
      workflowId: "workflow-1",
      projectId: "project-1",
      sourceType: "repository",
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/workflows/runs", {
      params: {
        workflowId: "workflow-1",
        scopeId: "project-1",
        sourceType: "repository",
      },
    });
  });

  it("getWorkflowLifecycleResults forwards lifecycle result filters", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkflowLifecycleResults({
      scopeId: "project-1",
      contextId: "context-1",
      phase: "review",
      hook: "before_transition",
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/lifecycle/results",
      {
        params: {
          scopeId: "project-1",
          contextId: "context-1",
          phase: "review",
          hook: "before_transition",
        },
      },
    );
    expect(result).toEqual([]);
  });

  it("refreshRepositoryWorkflows sends scope and root path", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { discovered: 0, upserted: 0, removed: 0 },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.refreshRepositoryWorkflows({
      scopeId: "project-1",
      rootPath: "G:/code/project",
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/workflows/repository/refresh",
      {
        scopeId: "project-1",
        rootPath: "G:/code/project",
      },
    );
    expect(result).toEqual({ discovered: 0, upserted: 0, removed: 0 });
  });
});

describe("ApiClient project methods", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
  });

  it("getProjects normalizes camelCase timestamp fields", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "project-1",
            name: "Nexus Build",
            createdAt: "2026-04-06T09:00:00.000Z",
            updatedAt: "2026-04-06T10:00:00.000Z",
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getProjects();

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/projects", undefined);
    expect(result[0]).toMatchObject({
      id: "project-1",
      created_at: "2026-04-06T09:00:00.000Z",
      updated_at: "2026-04-06T10:00:00.000Z",
    });
  });

  it("createProject posts payload and returns project", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "project-1",
          name: "Nexus Build",
          repositoryUrl: "https://github.com/example/repo",
          basePath: ".",
          createdAt: "2026-04-06T09:00:00.000Z",
          updatedAt: "2026-04-06T10:00:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.createProject({
      name: "Nexus Build",
      repositoryUrl: "https://github.com/example/repo",
      basePath: ".",
      goals: [
        {
          title: "Ship goal management",
          moscow: "must",
          priority: "p1",
        },
      ],
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith("/projects", {
      name: "Nexus Build",
      repositoryUrl: "https://github.com/example/repo",
      basePath: ".",
      goals: [
        {
          title: "Ship goal management",
          moscow: "must",
          priority: "p1",
        },
      ],
    });
    expect(result.id).toBe("project-1");
    expect(result.updated_at).toBe("2026-04-06T10:00:00.000Z");
  });

  it("getProjectGoals requests project goals with include_archived query", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "goal-1",
            projectId: "project-1",
            title: "Ship goals",
            status: "todo",
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getProjectGoals("project-1", {
      includeArchived: true,
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/goals?include_archived=true",
      undefined,
    );
    expect(result[0].id).toBe("goal-1");
  });

  it("createProjectGoalWorklog posts worklog payload", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "log-1",
          goalId: "goal-1",
          projectId: "project-1",
          entryType: "note",
          authorType: "user",
          note: "Investigated blockers",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.createProjectGoalWorklog(
      "project-1",
      "goal-1",
      {
        note: "Investigated blockers",
        author_type: "user",
      },
    );

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/goals/goal-1/worklogs",
      {
        note: "Investigated blockers",
        author_type: "user",
      },
    );
    expect(result.id).toBe("log-1");
  });

  it("updateProjectWorkItemStatus patches status and returns updated item", async () => {
    mockAxiosClient.patch.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          workItem: {
            id: "item-1",
            projectId: "project-1",
            title: "Implement board",
            status: "in-progress",
            type: "story",
            priority: "p1",
            tokenSpend: 120,
          },
          triggeredRunIds: ["run-1"],
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.updateProjectWorkItemStatus(
      "project-1",
      "item-1",
      {
        status: "in-progress",
        bypassReadinessGates: true,
      },
    );

    expect(mockAxiosClient.patch).toHaveBeenCalledWith(
      "/projects/project-1/work-items/item-1/status",
      { status: "in-progress", bypassReadinessGates: true },
    );
    expect(result.triggeredRunIds).toEqual(["run-1"]);
  });

  it("getWorkItemAutomationTriggers returns statuses", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: ["todo", "in-progress"],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkItemAutomationTriggers("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/work-items/automation-triggers",
      undefined,
    );
    expect(result).toEqual(["todo", "in-progress"]);
  });

  it("getWorkItemRealtimeConfig returns websocket configuration", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          wsUrl: "http://127.0.0.1:3011",
          namespace: "/kanban",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getWorkItemRealtimeConfig("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/work-items/realtime-config",
      undefined,
    );
    expect(result.wsUrl).toBe("http://127.0.0.1:3011");
  });

  it("getProjectRepositoryBranches returns branch list", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: ["main", "feature/epic-21"],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getProjectRepositoryBranches("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/repository/branches",
      undefined,
    );
    expect(result).toEqual(["main", "feature/epic-21"]);
  });

  it("getProjectRepositoryFiles returns file list", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: ["src/app.ts", "README.md"],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getProjectRepositoryFiles("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/repository/files",
      undefined,
    );
    expect(result).toEqual(["src/app.ts", "README.md"]);
  });

  it("getProjectAgentsFile returns AGENTS.md document metadata", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          projectId: "project-1",
          path: "AGENTS.md",
          exists: true,
          content: "# Instructions",
          etag: "etag-1",
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getProjectAgentsFile("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/repository/agents-file",
      undefined,
    );
    expect(result.path).toBe("AGENTS.md");
    expect(result.etag).toBe("etag-1");
  });

  it("updateProjectAgentsFile sends expected_etag payload", async () => {
    mockAxiosClient.put.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          projectId: "project-1",
          path: "AGENTS.md",
          exists: true,
          content: "# Updated instructions",
          etag: "etag-2",
          updatedAt: "2026-04-11T00:05:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.updateProjectAgentsFile("project-1", {
      content: "# Updated instructions",
      expectedEtag: "etag-1",
    });

    expect(mockAxiosClient.put).toHaveBeenCalledWith(
      "/projects/project-1/repository/agents-file",
      {
        content: "# Updated instructions",
        expected_etag: "etag-1",
      },
    );
    expect(result.etag).toBe("etag-2");
  });

  it("upsertWorkItemExecutionConfig saves config and returns updated work item", async () => {
    mockAxiosClient.patch.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "item-1",
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/epic-21",
            contextFiles: ["src/app.ts"],
            documentationUrls: [],
          },
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.upsertWorkItemExecutionConfig(
      "project-1",
      "item-1",
      {
        baseBranch: "main",
        targetBranch: "feature/epic-21",
        contextFiles: ["src/app.ts"],
      },
    );

    expect(mockAxiosClient.patch).toHaveBeenCalledWith(
      "/projects/project-1/work-items/item-1/execution-config",
      {
        baseBranch: "main",
        targetBranch: "feature/epic-21",
        contextFiles: ["src/app.ts"],
      },
    );
    expect(result.executionConfig?.targetBranch).toBe("feature/epic-21");
  });

  it("pauseWorkflowRun posts pause command", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { containerId: "container-1" },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.pauseWorkflowRun("run-1");

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/workflows/runs/run-1/control/pause",
      {},
    );
    expect(result.containerId).toBe("container-1");
  });

  it("abortWorkflowRun accepts nullable container ids", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { containerId: null },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.abortWorkflowRun("run-1");

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/workflows/runs/run-1/control/abort",
      {},
    );
    expect(result.containerId).toBeNull();
  });

  it("injectWorkflowRunMessage posts user guidance", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { acknowledged: true },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.injectWorkflowRunMessage("run-1", "Hint");

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/workflows/runs/run-1/inject",
      { message: "Hint" },
    );
    expect(result.acknowledged).toBe(true);
  });

  it("getWorkflowRunWorkspaceTree returns tree nodes", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [{ name: "src", path: "src", type: "directory", children: [] }],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getWorkflowRunWorkspaceTree("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/workspace/tree",
      undefined,
    );
    expect(result[0].name).toBe("src");
  });

  it("getWorkflowRunWorkspaceDiff returns diff payload", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { diff: "diff --git a/a.ts b/a.ts" },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getWorkflowRunWorkspaceDiff("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/workspace/diff",
      undefined,
    );
    expect(result.diff).toContain("diff --git");
  });

  it("getWorkflowRunTodoList returns todo list payload", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          workflow_run_id: "run-1",
          scope_id: "scope-1",
          context_id: "context-1",
          todo_list: [
            {
              id: "todo-1",
              title: "Implement endpoint",
              status: "in-progress",
              order_index: 0,
              source_kind: "manual",
              source_context_item_id: null,
              updated_at: "2026-04-12T00:00:00.000Z",
            },
          ],
          summary: {
            total_count: 1,
            completed_count: 0,
            in_progress_count: 1,
            not_started_count: 0,
          },
          source: {
            mode: "manual",
            has_drift: false,
            stale_count: 0,
          },
          _markdown: "# Run Todo List",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getWorkflowRunTodoList("run-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/workflows/runs/run-1/todo-list",
      undefined,
    );
    expect(result.todo_list[0]?.status).toBe("in-progress");
  });

  it("updateWorkflowRunTodoList posts replacement todo list", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          workflow_run_id: "run-1",
          scope_id: "scope-1",
          context_id: "context-1",
          todo_list: [
            {
              id: "todo-1",
              title: "Implement endpoint",
              status: "completed",
              order_index: 0,
              source_kind: "manual",
              source_context_item_id: null,
              updated_at: "2026-04-12T00:00:00.000Z",
            },
          ],
          summary: {
            total_count: 1,
            completed_count: 1,
            in_progress_count: 0,
            not_started_count: 0,
          },
          source: {
            mode: "manual",
            has_drift: false,
            stale_count: 0,
          },
          _markdown: "# Run Todo List",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.updateWorkflowRunTodoList("run-1", {
      todo_list: [
        {
          id: "todo-1",
          title: "Implement endpoint",
          status: "completed",
        },
      ],
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/workflows/runs/run-1/todo-list",
      {
        todo_list: [
          {
            id: "todo-1",
            title: "Implement endpoint",
            status: "completed",
          },
        ],
      },
    );
    expect(result.todo_list[0]?.status).toBe("completed");
  });

  it("deleteWorkflow tolerates empty 204 response bodies", async () => {
    mockAxiosClient.delete.mockResolvedValueOnce({ data: undefined });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await expect(
      apiClient.deleteWorkflow("workflow-1"),
    ).resolves.toBeUndefined();
    expect(mockAxiosClient.delete).toHaveBeenCalledWith(
      "/workflows/workflow-1",
    );
  });

  it("updateWorkItem patches work item fields", async () => {
    mockAxiosClient.patch.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "item-1",
          projectId: "project-1",
          title: "Updated Title",
          status: "todo",
          type: "epic",
          priority: "p1",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.updateWorkItem("project-1", "item-1", {
      title: "Updated Title",
      priority: "p1",
    });

    expect(mockAxiosClient.patch).toHaveBeenCalledWith(
      "/projects/project-1/work-items/item-1",
      { title: "Updated Title", priority: "p1" },
    );
    expect(result.title).toBe("Updated Title");
    expect(result.priority).toBe("p1");
  });

  it("getProjectOrchestrationState returns orchestration and project state", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          orchestration: {
            id: "orch-1",
            projectId: "project-1",
            status: "awaiting_approval",
            goals: "Ship auth flow",
            revisionFeedback: null,
            orchestrationMode: "supervised",
            strategySummary: null,
            currentWorkflowRunId: null,
            decisionLog: [],
            metadata: null,
            created_at: "2026-04-04T10:00:00.000Z",
            updated_at: "2026-04-04T10:00:00.000Z",
          },
          projectState: {
            projectId: "project-1",
            totalCount: 4,
            activeCount: 2,
            groupedByStatus: {},
          },
          pendingActionRequests: [],
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getProjectOrchestrationState("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/orchestration",
      undefined,
    );
    expect(result.orchestration?.status).toBe("awaiting_approval");
    expect(result.projectState.totalCount).toBe(4);
    expect(result.pendingActionRequests).toEqual([]);
  });

  it("startProjectOrchestration posts goals and orchestration_mode without stale workflow defaults", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Build EPIC-047 UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.startProjectOrchestration("project-1", {
      goals: "Build EPIC-047 UX",
      orchestrationMode: "supervised",
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/start",
      {
        goals: "Build EPIC-047 UX",
        orchestration_mode: "supervised",
      },
    );
    expect(result.status).toBe("initializing");
  });

  it("startProjectOrchestration passes routing context fields", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "orch-1",
          projectId: "project-1",
          status: "initializing",
          goals: "Build EPIC-047 UX",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    await apiClient.startProjectOrchestration("project-1", {
      goals: "Build EPIC-047 UX",
      sourceContext: { sourceType: "github", sourceId: "repo-1" },
      readinessContext: { isReady: true },
      startupHints: { preferredRouteId: "bootstrap" },
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/start",
      {
        goals: "Build EPIC-047 UX",
        source_context: { sourceType: "github", sourceId: "repo-1" },
        readiness_context: { isReady: true },
        startup_hints: { preferredRouteId: "bootstrap" },
      },
    );
  });

  it("recoverImportedHydrationProjectOrchestration posts the recovery endpoint", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "orch-1",
          projectId: "project-1",
          status: "orchestrating",
          goals: "Recover import hydration",
          revisionFeedback: null,
          orchestrationMode: "autonomous",
          strategySummary: null,
          currentWorkflowRunId: "run-2",
          decisionLog: [],
          metadata: null,
          created_at: "2026-04-04T10:00:00.000Z",
          updated_at: "2026-04-04T10:00:00.000Z",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result =
      await apiClient.recoverImportedHydrationProjectOrchestration("project-1");

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/recovery/imported-hydration",
      {},
    );
    expect(result.status).toBe("orchestrating");
    expect(result.currentWorkflowRunId).toBe("run-2");
  });

  it("getPendingProjectOrchestrationActions returns pending queue", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "req-1",
            projectId: "project-1",
            action: "dispatch_start_work_items",
            payload: { work_item_ids: ["wi-1"] },
            workflowRunId: "wf-1",
            modeAtRequest: "supervised",
            requestedBy: "ceo-agent",
            status: "pending",
            approvedBy: null,
            approvedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
            executedAt: null,
            errorMessage: null,
            correlationId: "corr-1",
            created_at: "2026-04-04T10:00:00.000Z",
            updated_at: "2026-04-04T10:00:00.000Z",
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result =
      await apiClient.getPendingProjectOrchestrationActions("project-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/pending-actions",
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
  });

  it("getOrchestrationActionRequests requests global list with status filter", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "req-1",
            projectId: "project-1",
            projectName: "Nexus",
            action: "dispatch_start_work_items",
            payload: null,
            workflowRunId: "wf-1",
            workflowId: "workflow-1",
            modeAtRequest: "supervised",
            requestedBy: "ceo-agent",
            status: "pending",
            approvedBy: null,
            approvedAt: null,
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
            executedAt: null,
            errorMessage: null,
            correlationId: "corr-1",
            created_at: "2026-04-04T10:00:00.000Z",
            updated_at: "2026-04-04T10:00:00.000Z",
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getOrchestrationActionRequests({
      status: "pending",
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/orchestration/action-requests?status=pending",
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].projectName).toBe("Nexus");
  });

  it("approveProjectOrchestrationAction posts action_request_id", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "req-1",
          status: "executed",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.approveProjectOrchestrationAction(
      "project-1",
      "req-1",
      "user-1",
    );

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/action-requests/req-1/approve",
      { approved_by: "user-1" },
    );
    expect(result.status).toBe("executed");
  });

  it("rejectProjectOrchestrationAction posts reason payload", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "req-1",
          status: "rejected",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.rejectProjectOrchestrationAction(
      "project-1",
      {
        actionRequestId: "req-1",
        reason: "Need manual review",
        rejectedBy: "user-2",
      },
    );

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/projects/project-1/orchestration/action-requests/req-1/reject",
      {
        reason: "Need manual review",
        rejected_by: "user-2",
      },
    );
    expect(result.status).toBe("rejected");
  });
});

describe("ApiClient MCP methods", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
  });

  it("getMcpServers requests MCP server list", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            id: "server-1",
            name: "Git MCP",
            enabled: true,
            transport_type: "http",
            timeout_ms: 30000,
            connect_timeout_ms: 10000,
            max_retries: 2,
            retry_backoff_ms: 1000,
            last_status: "connected",
            created_at: "2026-04-12T00:00:00.000Z",
            updated_at: "2026-04-12T00:00:00.000Z",
          },
        ],
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getMcpServers();

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/mcp/servers", undefined);
    expect(result[0]?.name).toBe("Git MCP");
  });

  it("createMcpServer and reloadMcpServers use expected routes", async () => {
    mockAxiosClient.post
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "server-1",
            name: "Git MCP",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            total_servers: 1,
            succeeded_servers: 1,
            failed_servers: 0,
            results: [],
            started_at: "2026-04-12T00:00:00.000Z",
            completed_at: "2026-04-12T00:00:01.000Z",
          },
        },
      });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.createMcpServer({
      name: "Git MCP",
      transport_type: "http" as CreateMcpServerRequest["transport_type"],
      url: "http://localhost:4000/mcp",
    });
    await apiClient.reloadMcpServers();

    expect(mockAxiosClient.post).toHaveBeenNthCalledWith(1, "/mcp/servers", {
      name: "Git MCP",
      transport_type: "http",
      url: "http://localhost:4000/mcp",
    });
    expect(mockAxiosClient.post).toHaveBeenNthCalledWith(2, "/mcp/reload", {});
  });
});

describe("ApiClient doctor operations methods", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
      writable: true,
    });
  });

  it("requests doctor report envelope", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          report: {
            generated_at: "2026-04-12T00:00:00.000Z",
            overall_status: "ok",
            summary: {
              ok: 1,
              warn: 0,
              fail: 0,
              total: 1,
            },
            checks: [],
          },
          summary_markdown: "# Doctor Report",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;
    const result = await apiClient.getDoctorReportEnvelope();

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/operations/doctor",
      undefined,
    );
    expect(result.report.overall_status).toBe("ok");
  });

  it("executes doctor repair action", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          attempt_id: "attempt-1",
          action_id: "refresh_mcp_plugin_catalogs",
          status: "succeeded",
          dry_run: true,
          started_at: "2026-04-12T00:00:00.000Z",
          finished_at: "2026-04-12T00:00:01.000Z",
          message: "Dry run complete",
          changes: {},
          evidence: {},
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.executeDoctorRepair({
      action_id: "refresh_mcp_plugin_catalogs",
      dry_run: true,
      arguments: {},
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/operations/doctor/repair",
      {
        action_id: "refresh_mcp_plugin_catalogs",
        dry_run: true,
        arguments: {},
      },
    );
  });

  it("requests doctor history with filters", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.getDoctorRepairHistory({
      limit: 20,
      offset: 0,
      status: "failed",
      action_id: "refresh_mcp_plugin_catalogs",
    });

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/operations/doctor/history?limit=20&offset=0&action_id=refresh_mcp_plugin_catalogs&status=failed",
      undefined,
    );
  });

  it("getNotificationsWebsocketConfig returns wsUrl and namespace", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          wsUrl: "http://localhost:3011",
          namespace: "/notifications",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getNotificationsWebsocketConfig();

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/notifications/inbox/websocket-config",
      undefined,
    );
    expect(result.wsUrl).toBe("http://localhost:3011");
    expect(result.namespace).toBe("/notifications");
  });
});
