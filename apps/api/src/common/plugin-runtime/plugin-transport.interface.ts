/**
 * Shared Transport Interface for Plugin Protocol Integrations.
 *
 * This documentation explains the transport architecture for MCP and ACP
 * plugin protocol integrations.
 *
 * ## Design Rationale
 *
 * ### Why a shared interface when ACP only uses HTTP?
 *
 * The shared interface exists for future extensibility and consistency:
 *
 * 1. **Future ACP transport expansion**: If ACP ever needs to support
 *    additional transport types (e.g., WebSocket for real-time streaming,
 *    STDIO for local agent processes), the infrastructure is already in place.
 *
 * 2. **Consistency**: Both MCP and ACP follow the same architectural pattern
 *    (Controller → Service → Runtime Manager → Transport). A shared interface
 *    makes the code more maintainable and reduces duplication.
 *
 * 3. **Protocol abstraction**: The interface decouples the runtime manager
 *    from specific transport implementations. This allows:
 *    - Easier testing (mock transports)
 *    - Runtime transport selection
 *    - Protocol-agnostic tooling
 *
 * ### Current Transport Support by Protocol
 *
 * | Protocol | HTTP | STDIO | Future Options |
 * |----------|------|-------|----------------|
 * | MCP      | ✅   | ✅    | WebSocket, gRPC |
 * | ACP      | ✅   | ❌    | STDIO (local agents) |
 *
 * ### MCP's need for multiple transports
 *
 * MCP (Model Context Protocol) is designed for tool servers that may run:
 * - **HTTP**: For remote servers, cloud-based tools, network-accessible services
 * - **STDIO**: For local processes, developer tools, CLI applications
 *
 * MCP's STDIO support is essential because many MCP tool servers are installed
 * as command-line tools (e.g., `npx`, `uvx`, native binaries) that communicate
 * via stdin/stdout.
 *
 * ### ACP's single HTTP transport
 *
 * ACP (Agent Communication Protocol) is designed for remote agent services
 * that expose HTTP APIs. The protocol assumes:
 * - Network-accessible endpoints
 * - Stateful sessions (via run IDs)
 * - REST-like request/response patterns
 *
 * ACP does not need STDIO because:
 * - Agents are typically remote services, not local CLI tools
 * - The protocol includes session management that works best over HTTP
 * - Agent processes are managed externally (container orchestration, etc.)
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    Runtime Manager                          │
 * │  ┌───────────────────────────────────────────────────────┐ │
 * │  │            PluginTransportFactory                     │ │
 * │  │  ┌─────────────────┐  ┌─────────────────┐            │ │
 * │  │  │  HTTP Client    │  │  STDIO Client   │            │ │
 * │  │  │                 │  │                 │            │ │
 * │  │  │  - JSON-RPC     │  │  - Content-     │            │ │
 * │  │  │  - Initialize   │  │    Length       │            │ │
 * │  │  │  - Runtime ctx  │  │  - stdin/stdout │            │ │
 * │  │  └─────────────────┘  └─────────────────┘            │ │
 * │  └───────────────────────────────────────────────────────┘ │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Extensibility
 *
 * To add a new transport type:
 *
 * 1. Create a transport client class implementing `PluginTransportClient`
 * 2. Register it with the factory using `registerTransport()`
 * 3. Ensure the server entity has a `transport_type` field
 *
 * @module
 *
 * @see plugin-transport.types.ts for type definitions
 * @see plugin-transport.factory.ts for the generic factory implementation
 * @see mcp-transport.factory.ts for the MCP-specific factory
 */
