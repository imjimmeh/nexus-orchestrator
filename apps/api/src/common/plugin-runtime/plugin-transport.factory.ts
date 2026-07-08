/**
 * Generic plugin transport factory for multi-protocol support.
 *
 * This factory provides a unified interface for creating transport clients
 * across different plugin protocols (MCP, ACP, etc.) and transport types
 * (HTTP, STDIO, etc.).
 *
 * ## Architecture
 *
 * The factory uses a registry pattern to support multiple transport types:
 * - Each protocol registers its supported transport types
 * - Transport selection is based on the server's transport type field
 * - New transport types can be added without modifying existing code
 *
 * ## Extensibility
 *
 * To add support for a new transport type (e.g., WebSocket):
 *
 * 1. Create a transport client for the new type:
 *    ```typescript
 *    export class WebSocketTransportClient implements PluginTransportClient<T> {
 *      // Implementation...
 *    }
 * ```
 *
 * 2. Register the transport client with the factory:
 *    ```typescript
 *    factory.registerTransport(
 *      'websocket',
 *      () => new WebSocketTransportClient(),
 *    );
 *    ```
 *
 * ## Current Protocol Support
 *
 * | Protocol | HTTP | STDIO |
 * |----------|------|-------|
 * | MCP      | ✅   | ✅    |
 * | ACP      | ✅   | ❌    |
 *
 * @module
 */

import { Injectable, Logger } from '@nestjs/common';
import type { McpToolsListResult } from '@nexus/core';
import type {
  PluginTransportClient,
  PluginTransportHandler,
  PluginRuntimeContext,
  PluginInvokeResult,
  TransportTypeExtractor,
} from './plugin-transport.types';

// Re-export types for consumers
export type {
  PluginTransportClient,
  PluginTransportHandler,
  PluginRuntimeContext,
  TransportTypeExtractor,
} from './plugin-transport.types';

/**
 * Registry entry for a transport type.
 */
interface TransportRegistryEntry<TContext extends PluginRuntimeContext> {
  /** Factory function to create the transport client */
  factory: () => PluginTransportClient<unknown, TContext>;
  /** Human-readable description of this transport type */
  description: string;
}

/**
 * Default transport type extractor that reads from standard server entities.
 *
 * Supports:
 * - MCP servers: `server.transport_type` field
 * - Generic servers with `transport_type` field
 */
export function createTransportTypeExtractor(
  fieldName: string = 'transport_type',
): TransportTypeExtractor {
  return {
    getTransportType(server: unknown): string {
      const s = server as Record<string, unknown>;
      const type = s[fieldName];
      if (!type || typeof type !== 'string') {
        throw new Error(
          `Server entity is missing or has invalid '${fieldName}' field`,
        );
      }
      return type;
    },
  };
}

/**
 * Generic transport factory for plugin protocols.
 *
 * This factory is designed to be protocol-agnostic and supports:
 * - Multiple transport types per protocol
 * - Dynamic transport registration
 * - Lazy client instantiation (clients created on first use)
 * - Per-request context passing
 *
 * @example
 * ```typescript
 * // Create factory with registry
 * const factory = new PluginTransportFactory<MyServer>({
 *   http: () => new MyHttpTransport(),
 *   stdio: () => new MyStdioTransport(),
 * });
 *
 * // List tools via the factory
 * const result = await factory.listTools(server);
 *
 * // Call a tool via the factory
 * const result = await factory.callTool(server, 'myTool', { arg: 'value' });
 * ```
 */
@Injectable()
export class PluginTransportFactory<
  TServer,
  TContext extends PluginRuntimeContext = PluginRuntimeContext,
> {
  private readonly logger = new Logger(PluginTransportFactory.name);
  private readonly registry = new Map<
    string,
    TransportRegistryEntry<TContext>
  >();
  private readonly clientCache = new Map<
    string,
    PluginTransportClient<TServer, TContext>
  >();
  private transportTypeExtractor?: TransportTypeExtractor;

  constructor(
    private readonly name: string = 'generic',
    transportHandlers?: PluginTransportHandler<TServer, TContext>,
  ) {
    if (transportHandlers) {
      this.registerFromHandlers(transportHandlers);
    }
  }

  /**
   * Set the transport type extractor for server routing.
   *
   * @param extractor - Function to extract transport type from server entities
   */
  setTransportTypeExtractor(extractor: TransportTypeExtractor): void {
    this.transportTypeExtractor = extractor;
  }

  /**
   * Register a transport type with its client factory.
   *
   * @param transportType - The transport type identifier (e.g., 'http', 'stdio')
   * @param factory - Factory function to create the transport client
   * @param description - Human-readable description for debugging
   */
  registerTransport(
    transportType: string,
    factory: () => PluginTransportClient<TServer, TContext>,
    description: string = transportType,
  ): void {
    if (this.registry.has(transportType)) {
      this.logger.warn(
        `Overwriting existing transport handler for type '${transportType}' in factory '${this.name}'`,
      );
    }

    this.registry.set(transportType, {
      factory,
      description,
    });

    this.logger.debug(
      `Registered transport '${transportType}' for factory '${this.name}': ${description}`,
    );
  }

  /**
   * Register multiple transport handlers at once.
   *
   * @param handlers - Object mapping transport types to their factories
   */
  registerFromHandlers(
    handlers: PluginTransportHandler<TServer, TContext>,
  ): void {
    for (const [transportType, handler] of Object.entries(handlers)) {
      if (typeof handler === 'function') {
        this.registerTransport(transportType, handler);
      } else if (handler && typeof handler === 'object') {
        this.registerTransport(
          transportType,
          handler.factory,
          handler.description,
        );
      }
    }
  }

  /**
   * Check if a transport type is registered.
   *
   * @param transportType - The transport type to check
   * @returns True if the transport type is registered
   */
  hasTransport(transportType: string): boolean {
    return this.registry.has(transportType);
  }

  /**
   * Get a list of all registered transport types.
   *
   * @returns Array of registered transport type identifiers
   */
  getRegisteredTransports(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Get the client for a specific transport type.
   *
   * Clients are created lazily and cached for reuse.
   *
   * @param transportType - The transport type to get
   * @returns The transport client (throws if not registered)
   */
  getTransportClient(
    transportType: string,
  ): PluginTransportClient<TServer, TContext> {
    if (!this.registry.has(transportType)) {
      throw new Error(
        `Transport type '${transportType}' is not registered in factory '${this.name}'. ` +
          `Registered types: ${this.getRegisteredTransports().join(', ') || 'none'}`,
      );
    }

    if (!this.clientCache.has(transportType)) {
      const entry = this.registry.get(transportType);
      if (!entry) {
        throw new Error(`Transport type '${transportType}' is not registered`);
      }
      this.clientCache.set(transportType, entry.factory());
    }

    const client = this.clientCache.get(transportType);
    if (!client) {
      throw new Error(
        `Failed to retrieve cached client for transport type '${transportType}'`,
      );
    }
    return client;
  }

  /**
   * Route a server to its appropriate transport client.
   *
   * Uses the configured transport type extractor to determine
   * which transport to use based on the server entity.
   *
   * @param server - The server entity
   * @returns The appropriate transport client
   */
  routeToTransport(server: TServer): PluginTransportClient<TServer, TContext> {
    if (!this.transportTypeExtractor) {
      throw new Error(
        `No transport type extractor configured for factory '${this.name}'. ` +
          `Call setTransportTypeExtractor() before routing.`,
      );
    }

    const transportType = this.transportTypeExtractor.getTransportType(server);
    return this.getTransportClient(transportType);
  }

  /**
   * List tools/agents from a server.
   *
   * Automatically routes to the appropriate transport based on
   * the server's transport type field.
   *
   * @param server - The server entity
   * @returns Discovery result containing available tools/agents
   */
  async listTools(server: TServer): Promise<McpToolsListResult> {
    const transportType = this.getTransportType(server);
    const client = this.getTransportClient(transportType);
    return client.listTools(server);
  }

  /**
   * Call a tool/agent on a server.
   *
   * Automatically routes to the appropriate transport based on
   * the server's transport type field.
   *
   * @param server - The server entity
   * @param name - The name of the tool/agent to invoke
   * @param params - Parameters to pass to the tool/agent
   * @param context - Optional runtime context for workflow tracking
   * @returns Result of the invocation
   */
  async callTool(
    server: TServer,
    name: string,
    params: Record<string, unknown>,
    context?: TContext,
  ): Promise<PluginInvokeResult> {
    const transportType = this.getTransportType(server);
    const client = this.getTransportClient(transportType);
    return client.callTool(server, name, params, context);
  }

  /**
   * Close all cached transport clients.
   *
   * This should be called during module cleanup to properly
   * release resources (e.g., STDIO processes).
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [transportType, client] of this.clientCache.entries()) {
      try {
        closePromises.push(
          client.close().then(() => {
            this.logger.debug(
              `Closed transport client for type '${transportType}' in factory '${this.name}'`,
            );
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Error closing transport client for type '${transportType}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await Promise.allSettled(closePromises);
    this.clientCache.clear();
  }

  private getTransportType(server: TServer): string {
    if (this.transportTypeExtractor) {
      return this.transportTypeExtractor.getTransportType(server);
    }

    // Fallback: try to extract from standard 'transport_type' field
    const s = server as Record<string, unknown>;
    const type = s['transport_type'];

    if (typeof type === 'string') {
      return type;
    }

    throw new Error(
      `Cannot determine transport type for server. ` +
        `Either set a transport type extractor or ensure the server has a 'transport_type' string field.`,
    );
  }
}
