import type { ResolvedMcpServerDescriptor } from "@nexus/core";
import type { CanonicalToolDefinition } from "@nexus/harness-runtime";

export interface McpClientHandle {
  listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** Injectable dependency boundary for tests — connect is the only seam. */
export interface McpBridgeDeps {
  connect(descriptor: ResolvedMcpServerDescriptor): Promise<McpClientHandle>;
}

export interface BridgedExtensions {
  tools: CanonicalToolDefinition[];
  dispose(): Promise<void>;
}
