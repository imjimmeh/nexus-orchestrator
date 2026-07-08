---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: core-shared
outcome: success
inferred_status: implemented
confidence_score: 0.85
evidence_refs:
  - packages/core/src/index.ts
  - packages/core/src/clients/index.ts
  - packages/core/src/interfaces/index.ts
  - packages/core/src/request-context/index.ts
  - packages/core/src/schemas/index.ts
  - packages/core/src/tool-policy/tool-policy.types.ts
  - packages/core/src/tool-policy/tool-policy.compiler.ts
  - packages/core/src/tool-policy/tool-policy.parser.ts
  - packages/core/src/clients/core-http.client.ts
  - packages/core/src/request-context/base-request-context.service.ts
  - packages/core/src/errors/error-envelope.types.ts
  - packages/core/src/schemas/events/event-envelope.schema.ts
  - packages/core/src/interfaces/acp.types.ts
  - Test files in packages/core/src/clients/core-http.client.spec.ts
  - Test files in packages/core/src/tool-policy/tool-policy.compiler.spec.ts
  - Test files in packages/core/src/request-context/base-request-context.service.spec.ts
source_paths:
  - packages/core/src
updated_at: 2026-05-22T00:00:00.000Z
---

# Probe Result: Core Shared Library

## Narrative Summary

The `packages/core/src` module serves as the foundational shared library for the project, providing a comprehensive set of reusable HTTP clients, interfaces, request context management, schema definitions, and tool policy handling. The library is well-structured with clear separation of concerns across clients, interfaces, schemas, request context, errors, and tool policy domains. Test coverage is present across key modules, with 19 spec files identified in the codebase.

## Capability Updates

### Clients (`packages/core/src/clients/`)
- **`CoreHttpClient`**: Implements workflow run requests, status checks, control actions, scope cancellation, and core event publishing with correlation/causation header propagation and dynamic authorization header resolution
- **`ChatHttpClient`**: HTTP client for chat service interactions
- **`http-request.ts`**: Core HTTP request abstraction with JSON serialization
- **Well-tested**: `core-http.client.spec.ts` (5 test cases) and `chat-http.client.spec.ts` cover workflows, correlation headers, and authorization

### Interfaces (`packages/core/src/interfaces/`)
- **ACP Types**: Agent Communication Protocol enums (transport, auth, run status, await policy) and interfaces for servers, runs, sessions, messages, and trajectories
- **MCP Types**: Model Context Protocol server and tool management
- **Automation Types**: Heartbeat profiles, standing orders, automation hooks
- **Chat Session Types**: Session state, retry metadata, failure info
- **Workflow Types**: Legacy workflow definitions and lifecycle policies
- **Event Types**: Core workflow, chat message, chat session, and memory events
- **Web Automation Types**: Browser automation action types and selectors
- **Scheduled Jobs**: Job types and run management
- **Tool Constants**: SDK native tool name registry
- **Service Clients**: Abstract client interfaces (CoreClient, ChatClient)

### Request Context (`packages/core/src/request-context/`)
- **`BaseRequestContextService`**: NestJS-compatible injectable service using `AsyncLocalStorage` for request-scoped context isolation (correlation ID, causation ID, request ID)
- **`CorrelationIdMiddleware`**: Express middleware for correlation/causation header injection
- **Well-tested**: `base-request-context.service.spec.ts` (2 tests), `correlation-id.middleware.spec.ts` (5+ tests)

### Schemas (`packages/core/src/schemas/`)
- **20+ schema subdirectories** including auth, users, chat, events, workflow-run, workflow-runtime, execution, tools, roles, ai-config, memory, setup, settings, operations, automation, capability-governance, acp, mcp, and startup-routing
- **Event Envelope Schema**: Strict Zod schemas for typed event envelopes with versioned event types
- **Execution Context Schema**: Schema for workflow/session execution context
- **Contract Schemas**: Service contracts for inter-service communication

### Tool Policy (`packages/core/src/tool-policy/`)
- **`tool-policy.types.ts`**: Core types - ToolPolicyEffect enum (ALLOW, DENY, REQUIRE_APPROVAL, GUARDRAIL_DENY), rule definitions, document structure, decision results, and validation helpers
- **`tool-policy.parser.ts`**: String rule parser for CLI-style policy syntax
- **`tool-policy.compiler.ts`**: Legacy array-to-document compiler with rule precedence (DENY > REQUIRE_APPROVAL > ALLOW)
- **Well-tested**: `tool-policy.compiler.spec.ts` (3 tests), `tool-policy.parser.spec.ts`, `tool-policy.spec.ts`

### Errors (`packages/core/src/errors/`)
- **`error-envelope.types.ts`**: Error envelope type definitions for structured error propagation
- **`agent-error-feedback.types.ts`**: Agent error feedback types for telemetry
- **Test coverage**: `error-envelope.types.spec.ts`

## Health Findings

### Test Coverage
- **19 spec files** identified across the core module
- Core functionality has test coverage: clients, request context, tool policy, schemas, error handling
- Tests use Vitest framework with mocking for HTTP operations

### Code Quality Indicators
- TypeScript strict typing throughout
- Zod schemas for runtime validation
- AsyncLocalStorage for context isolation (modern Node.js pattern)
- NestJS dependency injection compatibility
- Clear separation between types/interfaces and implementations

### Churn Risk Assessment
- Core types appear stable with no excessive mutation patterns
- Schema-based typing provides backward compatibility options
- Tool policy follows established DSL pattern

## Open Questions

- **Runtime Integration**: How does BaseRequestContextService integrate with the NestJS dependency injection container in production? The `@Injectable()` decorator is present but the service is class-based with manual instantiation capability.
- **Schema Evolution**: The strict `.strict()` Zod schemas may require careful migration strategy as event types evolve - any breaking changes should be versioned.
- **Tool Policy DSL**: The parser assumes a specific format (`effect tool [args]`); robustness testing for malformed input would clarify edge case handling.
- **Authorization Header Strategy**: The `authorizationHeaderResolver` pattern supports dynamic tokens but the resolution lifecycle (caching, refresh) is not visible in the client implementation.

---

```json
{
  "probe_scope_id": "core-shared",
  "outcome": "success",
  "artifact_path": "docs/project-context/probe-results/core-shared.md"
}
```