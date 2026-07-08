import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import jwt from "jsonwebtoken";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import { InternalServiceAuthGuard } from "../../src/common/internal-service-auth.guard";
import { KanbanMcpController } from "../../src/mcp/kanban-mcp.controller";
import { KanbanMcpService } from "../../src/mcp/kanban-mcp.service";
import { withEnv } from "./test-env";
import { listenOnRandomPort } from "./test-http";

type MockKanbanMcpService = {
  listTools: Mock<() => unknown[]>;
  callTool: Mock<
    (
      toolName: string,
      args: Record<string, unknown>,
      context: { correlationId: string | null; workflowRunId: string | null },
    ) => Promise<unknown>
  >;
};

const jwtSecret = "test-secret";
const mcpToolResult = {
  content: [
    { type: "text", text: JSON.stringify({ project_id: "project-1" }) },
  ],
  isError: false,
};

const toolsCallBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "kanban.project_state",
    arguments: { project_id: "project-1" },
  },
};

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

async function postMcp(
  baseUrl: string,
  authorization?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(toolsCallBody),
  });
}

describe("KanbanMcpController split-service integration", () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let restoreEnv: () => void;
  let baseUrl: string;
  let mcpService: MockKanbanMcpService;

  beforeAll(async () => {
    restoreEnv = withEnv({
      KANBAN_SERVICE_BEARER_TOKEN: "kanban-internal-token",
      JWT_SECRET: jwtSecret,
      KANBAN_SERVICE_JWT_AUDIENCE: "nexus-kanban-service",
      KANBAN_SERVICE_JWT_ISSUER: "nexus-api",
    });

    mcpService = {
      listTools: vi.fn<() => unknown[]>().mockReturnValue([]),
      callTool:
        vi.fn<
          (
            toolName: string,
            args: Record<string, unknown>,
            context: {
              correlationId: string | null;
              workflowRunId: string | null;
            },
          ) => Promise<unknown>
        >(),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [KanbanMcpController],
      providers: [
        InternalServiceAuthGuard,
        { provide: KanbanMcpService, useValue: mcpService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    baseUrl = await listenOnRandomPort(app);
  });

  beforeEach(() => {
    mcpService.callTool.mockResolvedValue(mcpToolResult);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    restoreEnv?.();
    await app?.close();
    await moduleRef?.close();
  });

  it("returns JSON-RPC tool results and forwards MCP request context", async () => {
    const response = await postMcp(baseUrl, "Bearer kanban-internal-token", {
      "x-correlation-id": "corr-1",
      "x-workflow-run-id": "run-1",
    });

    const body = (await response.json()) as unknown;

    expect(response.ok).toBe(true);
    expect(body).toEqual({ jsonrpc: "2.0", id: 1, result: mcpToolResult });
    expect(mcpService.callTool).toHaveBeenCalledWith(
      "kanban.project_state",
      { project_id: "project-1" },
      { correlationId: "corr-1", workflowRunId: "run-1" },
    );
  });

  it("rejects MCP requests without authorization", async () => {
    const response = await postMcp(baseUrl);

    expect(response.ok).toBe(false);
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it("rejects MCP requests with the wrong static token", async () => {
    const response = await postMcp(baseUrl, "Bearer wrong-token");

    expect(response.ok).toBe(false);
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });

  it("accepts MCP requests with the valid static token", async () => {
    const response = await postMcp(baseUrl, "Bearer kanban-internal-token");

    expect(response.ok).toBe(true);
    expect(mcpService.callTool).toHaveBeenCalledTimes(1);
  });

  it("accepts MCP requests with a JWT carrying the MCP scope", async () => {
    const token = signServiceJwt(["kanban:mcp"]);
    const response = await postMcp(baseUrl, `Bearer ${token}`);

    expect(response.ok).toBe(true);
    expect(mcpService.callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects MCP requests when the JWT carries another scope", async () => {
    const token = signServiceJwt(["kanban.core-events:write"]);
    const response = await postMcp(baseUrl, `Bearer ${token}`);

    expect(response.ok).toBe(false);
    expect(mcpService.callTool).not.toHaveBeenCalled();
  });
});
