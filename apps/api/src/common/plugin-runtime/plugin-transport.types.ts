/**
 * Types for the plugin transport factory system.
 *
 * These types support the generic transport factory pattern used
 * across different plugin protocols (MCP, ACP, etc.).
 *
 * @module
 */

import type { McpToolsListResult } from '@nexus/core';

/**
 * Result of a tool/agent invocation.
 */
export interface PluginInvokeResult {
  result: Record<string, unknown> | unknown[];
}

/**
 * Runtime context passed through the call chain for workflow tracking.
 *
 * This allows the transport layer to forward context information
 * (workflow run ID, job ID, step ID) to the remote server.
 */
export interface PluginRuntimeContext {
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
}

/**
 * Transport client interface for plugin protocol integrations.
 *
 * Implementations handle the actual communication with remote
 * servers using protocol-specific mechanisms (HTTP, STDIO, etc.).
 *
 * @typeParam TServer - The server entity type for this transport
 * @typeParam TContext - Runtime context type for this transport (e.g., workflow tracking)
 */
export interface PluginTransportClient<
  TServer,
  TContext extends PluginRuntimeContext = PluginRuntimeContext,
> {
  /**
   * List all available tools/agents from the remote server.
   *
   * @param server - The server configuration
   * @returns Discovery result containing available items
   */
  listTools(server: TServer): Promise<McpToolsListResult>;

  /**
   * Invoke a tool/agent on the remote server.
   *
   * @param server - The server configuration
   * @param name - The name of the tool/agent to invoke
   * @param params - Parameters to pass to the tool/agent
   * @param context - Optional runtime context for workflow tracking
   * @returns Result of the invocation
   */
  callTool(
    server: TServer,
    name: string,
    params: Record<string, unknown>,
    context?: TContext,
  ): Promise<PluginInvokeResult>;

  /**
   * Close any resources held by the transport.
   *
   * For session-based transports (like STDIO), this cleans up
   * the process. For HTTP transports, this may be a no-op.
   *
   * @returns Promise that resolves when cleanup is complete
   */
  close(): Promise<void>;
}

/**
 * Factory function type for creating transport clients.
 *
 * @typeParam TServer - The server entity type
 * @typeParam TContext - Runtime context type
 */
export type PluginTransportFactoryFn<
  TServer,
  TContext extends PluginRuntimeContext = PluginRuntimeContext,
> = () => PluginTransportClient<TServer, TContext>;

/**
 * Transport handler can be either a factory function or an object
 * with factory and description.
 */
export type PluginTransportHandler<
  TServer,
  TContext extends PluginRuntimeContext = PluginRuntimeContext,
> = {
  [transportType: string]:
    | PluginTransportFactoryFn<TServer, TContext>
    | {
        factory: PluginTransportFactoryFn<TServer, TContext>;
        description?: string;
      };
};

/**
 * Registry of transport clients by type.
 */
export interface PluginTransportRegistry<
  TServer,
  TContext extends PluginRuntimeContext = PluginRuntimeContext,
> {
  /** Get the client for a specific transport type */
  get(transportType: string): PluginTransportClient<TServer, TContext>;

  /** Check if a transport type is registered */
  has(transportType: string): boolean;

  /** Get all registered transport types */
  keys(): string[];
}

/**
 * Server type marker for transport routing.
 *
 * Transport factories need to route requests based on both the protocol
 * and the transport type. This interface provides a standard way to
 * extract the transport type from any server entity.
 */
export interface TransportTypeExtractor<TRouterContext = unknown> {
  /**
   * Get the transport type for a given server entity.
   *
   * @param server - The server entity
   * @param context - Optional context for routing decisions
   * @returns The transport type identifier
   */
  getTransportType(server: unknown): string;

  /**
   * Optional context extraction for routing decisions.
   */
  getContext?(server: unknown): TRouterContext;
}
