import type { ResolvedMcpServerDescriptor } from "@nexus/core";
import {
  wrapToolWithGovernance,
  type CanonicalToolDefinition,
  type CheckPermission,
} from "@nexus/harness-runtime";
import type {
  BridgedExtensions,
  McpBridgeDeps,
  McpClientHandle,
} from "./contribution-mcp-bridge.types.js";

export type {
  BridgedExtensions,
  McpBridgeDeps,
  McpClientHandle,
} from "./contribution-mcp-bridge.types.js";

/**
 * Connect each resolved MCP server descriptor, enumerate its tools, apply
 * include/exclude tool filtering, and register every surviving tool as a
 * governance-wrapped {@link CanonicalToolDefinition}.
 *
 * **Architecture note (Fix D):** MCP server connections are established
 * engine-side via `@modelcontextprotocol/sdk`. This is intentional: PI has no
 * native MCP client and runs in a separate package/container that cannot import
 * NestJS services. Server DEFINITIONS, secret resolution (env/headers), and
 * tool filtering are sourced from the single `apps/api/src/mcp` truth and
 * resolved API-side before the descriptor reaches the engine — the engine
 * receives ready-to-use `env`/`headers` maps and `includeTools`/`excludeTools`
 * lists. Do NOT re-route the socket through Nest — that is out of scope.
 *
 * Every bridged tool flows through `wrapToolWithGovernance(tool, checkPermission)`,
 * which gates calls by the job ∩ profile policy — a denied tool returns the
 * structured `permission_denied` result and the inner MCP `callTool` is NEVER
 * invoked. The bridge cannot widen the tool surface past the profile ceiling.
 *
 * Returns the governed tools plus a `dispose()` that closes every connected
 * client. Empty input yields no tools and a no-op dispose (byte-identical
 * behavior for an empty contribution bundle, so no regression when no
 * `mcpServerRefs` are configured).
 *
 * On a mid-loop connect failure, already-opened handles are closed before the
 * error is re-thrown (no resource leak).
 */
export async function bridgeMcpServersToGovernedTools(
  descriptors: ResolvedMcpServerDescriptor[],
  checkPermission: CheckPermission,
  deps: McpBridgeDeps = defaultMcpBridgeDeps(),
): Promise<BridgedExtensions> {
  const handles: McpClientHandle[] = [];
  const tools: CanonicalToolDefinition[] = [];

  for (const descriptor of descriptors) {
    let handle: McpClientHandle;
    try {
      handle = await deps.connect(descriptor);
    } catch (error) {
      // Dispose already-accumulated handles to avoid resource leaks.
      await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
      throw error;
    }

    handles.push(handle);

    const remoteTools = await handle.listTools();
    for (const remote of filterTools(remoteTools, descriptor)) {
      const bare: CanonicalToolDefinition = {
        name: remote.name,
        description:
          remote.description ?? `MCP tool ${remote.name} (${descriptor.name})`,
        parameters: remote.inputSchema,
        execute: async (_callId, params) =>
          handle.callTool(remote.name, params),
      };
      // Every tool is individually wrapped so that a governance denial for one
      // tool cannot inadvertently allow another — wrapToolWithGovernance gates
      // each call independently (job ∩ profile).
      tools.push(wrapToolWithGovernance(bare, checkPermission));
    }
  }

  return {
    tools,
    dispose: async () => {
      await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
    },
  };
}

/**
 * Apply `includeTools`/`excludeTools` filtering from the descriptor.
 *
 * Semantics (mirroring `apps/api/src/mcp` include/exclude logic):
 * 1. If `includeTools` is set, keep only tools whose name appears in the list.
 * 2. Then remove any tool whose name appears in `excludeTools`.
 * Both lists default to "no filter" when absent/undefined.
 */
function filterTools<T extends { name: string }>(
  tools: T[],
  descriptor: ResolvedMcpServerDescriptor,
): T[] {
  let filtered = tools;

  if (descriptor.includeTools !== undefined) {
    const allowed = new Set(descriptor.includeTools);
    filtered = filtered.filter((t) => allowed.has(t.name));
  }

  if (descriptor.excludeTools !== undefined) {
    const denied = new Set(descriptor.excludeTools);
    filtered = filtered.filter((t) => !denied.has(t.name));
  }

  return filtered;
}

/**
 * Default production MCP bridge deps: connects to each server via the
 * `@modelcontextprotocol/sdk` client (confirmed against v1.29.0).
 *
 * Secret resolution and tool filtering are handled API-side before the
 * descriptor reaches the engine. `env` and `headers` on the descriptor already
 * contain fully-resolved values. No secret value is ever logged.
 */
function defaultMcpBridgeDeps(): McpBridgeDeps {
  return {
    connect: async (descriptor) => {
      const { Client } =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const client = new Client(
        { name: "nexus-pi-bridge", version: "1.0.0" },
        { capabilities: {} },
      );

      if (descriptor.transportType === "stdio") {
        const { StdioClientTransport } =
          await import("@modelcontextprotocol/sdk/client/stdio.js");
        await client.connect(
          new StdioClientTransport({
            command: descriptor.command ?? "",
            args: descriptor.args,
            env: descriptor.env,
          }),
        );
      } else {
        const { StreamableHTTPClientTransport } =
          await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        await client.connect(
          new StreamableHTTPClientTransport(new URL(descriptor.url ?? ""), {
            requestInit:
              descriptor.headers != null
                ? { headers: descriptor.headers }
                : undefined,
          }),
        );
      }

      return {
        listTools: async () => {
          const res = await client.listTools();
          return res.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
        },
        callTool: async (name, args) =>
          client.callTool({ name, arguments: args }),
        close: async () => {
          await client.close();
        },
      };
    },
  };
}
