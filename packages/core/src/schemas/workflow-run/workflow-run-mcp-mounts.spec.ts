import { describe, expect, it } from "vitest";
import { McpTransportType, WorkflowRunRequestV1Schema } from "../..";

describe("WorkflowRunRequestV1Schema external MCP mounts", () => {
  it("accepts generic per-run external MCP mount configuration", () => {
    const parsed = WorkflowRunRequestV1Schema.parse({
      workflow_id: "workflow-1",
      input: {},
      launch_source: "manual",
      context: null,
      metadata: { correlation_id: "corr-1" },
      external_mcp_mounts: [
        {
          id: "external-tools",
          transport_type: McpTransportType.HTTP,
          url: "http://tools.local/mcp",
          include_tools: ["resource.state"],
          headers: { authorization: "Bearer token" },
        },
      ],
    });

    expect(parsed.external_mcp_mounts).toEqual([
      expect.objectContaining({
        id: "external-tools",
        transport_type: McpTransportType.HTTP,
      }),
    ]);
  });
});
