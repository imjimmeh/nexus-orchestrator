import { McpTransportType, type WorkflowRunRequestV1 } from "@nexus/core";

export function resolveKanbanExternalMcpMounts(): WorkflowRunRequestV1["external_mcp_mounts"] {
  const rawServerIds =
    process.env.KANBAN_MCP_SERVER_IDS ?? process.env.KANBAN_MCP_SERVER_ID;
  const serverIds =
    rawServerIds
      ?.split(",")
      .map((serverId) => serverId.trim())
      .filter((serverId) => serverId.length > 0) ?? [];

  if (serverIds.length > 0) {
    return serverIds.map((serverId) => ({
      id: serverId,
      serverId,
      transport_type: McpTransportType.HTTP,
    }));
  }

  const url = process.env.KANBAN_MCP_URL?.trim();
  if (!url) {
    return undefined;
  }

  return [
    {
      id: "kanban-mcp",
      transport_type: McpTransportType.HTTP,
      url,
      ...(process.env.KANBAN_SERVICE_BEARER_TOKEN
        ? {
            headers: {
              authorization: `Bearer ${process.env.KANBAN_SERVICE_BEARER_TOKEN}`,
            },
          }
        : {}),
    },
  ];
}
