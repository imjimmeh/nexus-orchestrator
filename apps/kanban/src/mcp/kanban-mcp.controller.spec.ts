import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { KanbanMcpService } from "./kanban-mcp.service";
import { KanbanMcpController } from "./kanban-mcp.controller";

describe("KanbanMcpController", () => {
  let service: {
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };
  let controller: KanbanMcpController;

  beforeEach(() => {
    service = {
      listTools: vi
        .fn()
        .mockReturnValue([
          { name: "kanban.project_state", inputSchema: { type: "object" } },
        ]),
      callTool: vi.fn().mockResolvedValue({ ok: true }),
    };
    controller = new KanbanMcpController(
      service as unknown as KanbanMcpService,
    );
  });

  it("responds to tools/list JSON-RPC requests", async () => {
    const response = await controller.handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      buildRequest(),
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "kanban.project_state", inputSchema: { type: "object" } },
        ],
      },
    });
  });

  it.each([
    ["string id", "request-1", "request-1"],
    ["null id", null, null],
    ["omitted id", undefined, null],
  ])("echoes %s in JSON-RPC responses", async (_caseName, id, expectedId) => {
    const response = await controller.handleJsonRpc(
      { jsonrpc: "2.0", id, method: "tools/list" },
      buildRequest(),
    );

    expect(response.id).toBe(expectedId);
  });

  it("passes tool call arguments and runtime context headers to the service", async () => {
    const response = await controller.handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "kanban.project_state",
          arguments: { project_id: "project-1" },
        },
      },
      buildRequest({
        "x-correlation-id": "corr-1",
        "x-workflow-run-id": "run-1",
        "x-job-id": "job-1",
        "x-step-id": "step-1",
      }),
    );

    expect(service.callTool).toHaveBeenCalledWith(
      "kanban.project_state",
      { project_id: "project-1" },
      {
        correlationId: "corr-1",
        workflowRunId: "run-1",
        jobId: "job-1",
        stepId: "step-1",
      },
    );
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  function buildRequest(headers: Record<string, string> = {}): Request {
    return { headers } as unknown as Request;
  }
});
