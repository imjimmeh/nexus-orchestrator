# Epic 009: REST API & Webhook Integration

## Overview

**Epic ID**: 009
**Layer**: Communication
**Status**: Not Started
**Priority**: High (P1)
**Estimated Timeline**: 1 week

## Context

Build the external-facing API layer that allows external systems to interact with Nexus Core Engine via REST endpoints and webhook events. This includes workflow CRUD operations, tool registry management, workflow execution status queries, and webhook handlers for triggering workflows from external systems like Kanban boards or GitHub.

The REST API is the primary integration point for external systems and UI clients to control and monitor the Nexus platform.

## Dependencies

**Upstream Dependencies**:
- Epic 002 (Core Infrastructure) - for NestJS and database
- Epic 005 (Workflow Engine) - for workflow operations
- Epic 004 (Tool Registry) - for tool operations

**Downstream Dependencies**:
- UI clients (separate frontend project)
- External webhook sources (Kanban, GitHub, etc.)

## Scope

### Included in This Epic

- **REST API Endpoints**
  - Workflow CRUD (GET, POST, PUT, DELETE /workflows)
  - Workflow execution (POST /workflows/:id/execute)
  - Workflow run status (GET /workflows/:id/runs)
  - Tool registry CRUD (GET, POST, PUT, DELETE /tools)
  - Session management (GET /sessions/:id)
  - Health check (GET /health)

- **Webhook Handlers**
  - POST /webhooks/kanban (for kanban.ticket.in_progress events)
  - POST /webhooks/github (for github.pull_request.opened events)
  - Generic webhook endpoint (POST /webhooks/:workflow_id)
  - Event schema validation (JSON Schema)
  - Workflow triggering based on event type

- **Authentication & Authorization**
  - JWT validation for all endpoints
  - API key support for webhooks
  - Role-based access control (Admin, Developer, Viewer)
  - Rate limiting (100 requests/minute per IP)

- **API Documentation**
  - OpenAPI/Swagger spec generation
  - Interactive API explorer (Swagger UI)
  - Request/response examples
  - Error response documentation

- **Input Validation**
  - Request body validation (class-validator)
  - Query parameter validation
  - YAML validation for workflow definitions
  - Comprehensive error messages

- **Pagination & Filtering**
  - List endpoints support pagination (limit, offset)
  - Filtering by status, date, etc.
  - Sorting support (created_at, updated_at)

### Out of Scope

- Workflow execution logic (Epic 005)
- WebSocket communication (Epic 007)
- UI client implementation (separate project)
- Advanced analytics endpoints (Epic 013)
- GraphQL API (future enhancement)

## Tasks

### REST API Setup
- [ ] Configure NestJS controllers and routing
- [ ] Set up global validation pipe (class-validator)
- [ ] Configure CORS (allow specific origins)
- [ ] Set up global exception filter
- [ ] Configure request logging middleware
- [ ] Test basic REST endpoint (GET /health)

### Workflow CRUD Endpoints
- [ ] Create WorkflowController
- [ ] Implement POST /workflows
  - Accept YAML workflow definition in request body
  - Validate YAML syntax and structure
  - Call WorkflowEngineService.createWorkflow()
  - Return created workflow with ID
- [ ] Implement GET /workflows/:id
  - Retrieve workflow by ID
  - Return workflow definition and metadata
  - Return 404 if not found
- [ ] Implement GET /workflows
  - List all workflows with pagination
  - Support filtering (is_active, created_after, etc.)
  - Support sorting (created_at desc by default)
- [ ] Implement PUT /workflows/:id
  - Update workflow definition
  - Validate new YAML
  - Version the workflow
  - Return updated workflow
- [ ] Implement DELETE /workflows/:id (soft delete)
  - Mark workflow as inactive (is_active = false)
  - Don't delete associated WorkflowRuns
  - Return 204 No Content
- [ ] Add DTO classes for request/response validation
- [ ] Test all CRUD endpoints with Postman/REST client

### Workflow Execution Endpoints
- [ ] Implement POST /workflows/:id/execute
  - Accept trigger data in request body
  - Call WorkflowEngineService.startWorkflow()
  - Return WorkflowRun ID and status
- [ ] Implement GET /workflows/:id/runs
  - List all workflow runs for a workflow
  - Support pagination and filtering
  - Return status, current_step, state_variables
- [ ] Implement GET /workflows/:id/runs/:runId
  - Get detailed workflow run status
  - Include step history, current state
  - Return 404 if not found
- [ ] Implement POST /workflows/:id/runs/:runId/pause
  - Pause running workflow
  - Call WorkflowEngineService.pauseWorkflow()
  - Return updated status
- [ ] Implement POST /workflows/:id/runs/:runId/resume
  - Resume paused workflow
  - Call WorkflowEngineService.resumeWorkflow()
  - Return updated status
- [ ] Test workflow execution endpoints

### Tool Registry Endpoints
- [ ] Create ToolController
- [ ] Implement POST /tools
  - Accept tool definition (name, code, schema, tier)
  - Validate TypeScript code (AST)
  - Call ToolRegistryService.createTool()
  - Return created tool with ID
- [ ] Implement GET /tools/:id
  - Retrieve tool by ID
  - Return tool definition and metadata
- [ ] Implement GET /tools
  - List all tools with pagination
  - Support filtering by tier
- [ ] Implement PUT /tools/:id
  - Update tool definition
  - Increment version
  - Return updated tool
- [ ] Implement DELETE /tools/:id (soft delete)
  - Mark tool as inactive
  - Return 204 No Content
- [ ] Test all tool endpoints

### Session Management Endpoints
- [ ] Create SessionController
- [ ] Implement GET /sessions/:id
  - Retrieve session tree metadata
  - Return workflow_run_id, last_leaf_node_id, created_at
  - Don't return full JSONL (too large)
- [ ] Implement GET /sessions/:id/events
  - Return session event history (from Redis Stream)
  - Support pagination
- [ ] Test session endpoints

### Webhook Handlers
- [ ] Create WebhookController
- [ ] Implement POST /webhooks/kanban
  - Accept Kanban webhook events
  - Validate event schema (kanban.ticket.in_progress)
  - Extract trigger data (ticket_id, repo_url, etc.)
  - Find workflow by trigger type
  - Call WorkflowEngineService.startWorkflow()
  - Return 202 Accepted
- [ ] Implement POST /webhooks/github
  - Accept GitHub webhook events
  - Validate event schema (pull_request.opened, etc.)
  - Extract trigger data
  - Start workflow
  - Return 202 Accepted
- [ ] Implement POST /webhooks/:workflow_id (generic)
  - Accept any JSON payload
  - Start specific workflow by ID
  - Pass payload as trigger data
  - Return 202 Accepted
- [ ] Add webhook signature validation (HMAC)
- [ ] Test webhook handlers with mock events

### Event Schema Validation
- [ ] Install ajv for JSON Schema validation
- [ ] Create webhook event schemas
  - kanban.ticket.in_progress schema
  - github.pull_request.opened schema
- [ ] Implement validation middleware
  - Validate request body against schema
  - Return 400 Bad Request if invalid
  - Include validation errors in response
- [ ] Test schema validation with invalid payloads

### Authentication & Authorization
- [ ] Install @nestjs/passport and passport-jwt
- [ ] Create JwtAuthGuard
  - Validate JWT from Authorization header
  - Extract user from JWT payload
  - Attach user to request object
- [ ] Create ApiKeyAuthGuard (for webhooks)
  - Validate X-API-Key header
  - Compare against stored API keys
- [ ] Create RolesGuard
  - Check user roles (Admin, Developer, Viewer)
  - Allow/deny based on endpoint requirements
- [ ] Apply guards to all endpoints
  - Workflow endpoints: JWT required
  - Webhook endpoints: API Key required
  - Health check: Public (no auth)
- [ ] Test authentication with valid/invalid tokens

### Rate Limiting
- [ ] Install @nestjs/throttler
- [ ] Configure rate limiting
  - Default: 100 requests/minute per IP
  - Webhook endpoints: 1000 requests/minute (higher limit)
- [ ] Apply rate limiting globally
- [ ] Return 429 Too Many Requests when limit exceeded
- [ ] Test rate limiting with burst requests

### OpenAPI/Swagger Documentation
- [ ] Install @nestjs/swagger
- [ ] Add Swagger decorators to all controllers
  - @ApiTags for grouping
  - @ApiOperation for endpoint descriptions
  - @ApiResponse for response schemas
  - @ApiProperty for DTO properties
- [ ] Configure Swagger module
  - Title: "Nexus Core Engine API"
  - Version: "1.0.0"
  - Description: API docs
- [ ] Serve Swagger UI at /api/docs
- [ ] Add request/response examples to docs
- [ ] Test Swagger UI (manual validation)

### Error Handling
- [ ] Create global exception filter
  - Catch all exceptions
  - Format error responses consistently
  - Include error code, message, details
  - Log errors with stack traces
- [ ] Create custom exception classes
  - WorkflowNotFoundException
  - InvalidYAMLException
  - AuthenticationException
- [ ] Return appropriate HTTP status codes
  - 400 Bad Request (validation errors)
  - 401 Unauthorized (missing/invalid auth)
  - 403 Forbidden (insufficient permissions)
  - 404 Not Found (resource doesn't exist)
  - 429 Too Many Requests (rate limit)
  - 500 Internal Server Error (unexpected errors)
- [ ] Test error handling with various error scenarios

### Pagination & Filtering
- [ ] Create PaginationDTO
  - limit (default: 20, max: 100)
  - offset (default: 0)
- [ ] Create FilterDTO for each resource
  - Workflows: is_active, created_after, created_before
  - WorkflowRuns: status, workflow_id
  - Tools: tier, is_active
- [ ] Implement pagination in service layer
- [ ] Return pagination metadata in responses
  - total count
  - current page
  - has_next, has_previous
- [ ] Test pagination with large datasets (100+ records)

### Testing & Documentation
- [ ] Write unit tests for all controllers
- [ ] Write E2E tests for all endpoints
  - Workflow CRUD flow
  - Tool CRUD flow
  - Webhook triggering
  - Authentication/authorization
- [ ] Write integration tests with database
- [ ] Document all API endpoints in README
- [ ] Create Postman collection for API testing
- [ ] Document webhook event schemas

## Key Deliverables

1. **REST API Controllers**
   - Workflow CRUD endpoints
   - Tool registry endpoints
   - Workflow execution endpoints
   - Session management endpoints

2. **Webhook Handlers**
   - Kanban webhook endpoint
   - GitHub webhook endpoint
   - Generic webhook endpoint

3. **Authentication & Authorization**
   - JWT validation
   - API key validation
   - Role-based access control

4. **OpenAPI Documentation**
   - Auto-generated Swagger spec
   - Interactive Swagger UI
   - Request/response examples

5. **Comprehensive Test Suite**
   - Unit tests for controllers
   - E2E tests for all endpoints
   - Integration tests

6. **Documentation**
   - API reference docs
   - Webhook integration guide
   - Postman collection

## Acceptance Criteria

- [ ] Workflows can be created via POST /workflows with YAML
- [ ] Workflows can be retrieved via GET /workflows/:id
- [ ] Workflow list supports pagination (limit, offset)
- [ ] Workflow execution status is available via GET /workflows/:id/runs
- [ ] Tools can be registered via POST /tools
- [ ] Tools can be listed via GET /tools with tier filtering
- [ ] Webhook events trigger workflow execution
- [ ] Webhook POST /webhooks/kanban accepts valid events
- [ ] Webhook POST /webhooks/github accepts valid events
- [ ] Event schema validation rejects malformed payloads (returns 400)
- [ ] JWT authentication protects all workflow/tool endpoints
- [ ] API keys authenticate webhook events (X-API-Key header)
- [ ] Invalid JWTs are rejected (returns 401)
- [ ] Missing authentication returns 401 Unauthorized
- [ ] Insufficient permissions return 403 Forbidden
- [ ] Rate limiting blocks requests exceeding 100/minute (returns 429)
- [ ] OpenAPI spec is auto-generated and accurate
- [ ] Swagger UI is accessible at /api/docs
- [ ] Swagger UI shows all endpoints with examples
- [ ] Error responses have consistent format (code, message, details)
- [ ] 404 errors return proper JSON response
- [ ] Unit tests cover all controller logic (80%+ coverage)
- [ ] E2E tests verify end-to-end API flows
- [ ] Pagination returns correct total count
- [ ] Filtering works for all supported fields

## Technical Notes

### Technology Stack
- **Framework**: NestJS v10+
- **Validation**: class-validator, class-transformer
- **Authentication**: @nestjs/passport, passport-jwt
- **Rate Limiting**: @nestjs/throttler
- **API Docs**: @nestjs/swagger
- **Schema Validation**: ajv

### API Response Format
```json
{
  "success": true,
  "data": {
    "id": "wf_123",
    "name": "Example Workflow",
    "created_at": "2026-03-22T10:00:00Z"
  },
  "meta": {
    "pagination": {
      "total": 42,
      "limit": 20,
      "offset": 0,
      "has_next": true
    }
  }
}
```

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "WORKFLOW_NOT_FOUND",
    "message": "Workflow with ID wf_123 not found",
    "details": {},
    "timestamp": "2026-03-22T10:00:00Z"
  }
}
```

### Webhook Event Schema (Kanban)
```json
{
  "event": "kanban.ticket.in_progress",
  "timestamp": "2026-03-22T10:00:00Z",
  "data": {
    "ticket_id": "JIRA-123",
    "repo_url": "https://github.com/org/repo",
    "assignee": "john@example.com"
  }
}
```

### Authentication Flow
```
1. Client sends request with Authorization: Bearer <jwt>
2. JwtAuthGuard extracts token
3. Validate JWT signature and expiration
4. Extract user from payload
5. Attach user to request.user
6. RolesGuard checks user.roles
7. Allow/deny request
```

### Rate Limiting Configuration
```typescript
ThrottlerModule.forRoot([{
  ttl: 60000, // 1 minute
  limit: 100, // 100 requests
}]);
```

### Swagger Configuration
```typescript
const config = new DocumentBuilder()
  .setTitle('Nexus Core Engine API')
  .setDescription('AI orchestration platform API')
  .setVersion('1.0')
  .addBearerAuth()
  .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' })
  .build();
```

### Security Considerations
- **JWT Validation**: Verify signature, expiration, issuer
- **API Key Storage**: Hash API keys in database (bcrypt)
- **CORS**: Whitelist specific origins only
- **Input Validation**: Validate all input (prevent injection)
- **Rate Limiting**: Prevent abuse and DoS attacks

### Testing Strategy
- **Unit Tests**: Controller methods, DTO validation
- **Integration Tests**: Database operations, service calls
- **E2E Tests**: Full request/response cycles
- **Load Tests**: Rate limiting, concurrent requests

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Authentication vulnerabilities | High | Medium | Use proven libraries (passport-jwt), security audit |
| Rate limiting bypass | Medium | Low | IP-based + user-based limits, monitoring |
| YAML injection attacks | High | Low | Validate YAML, sanitize input, sandboxed parsing |
| Webhook replay attacks | Medium | Medium | Signature validation (HMAC), timestamp checks |
| API documentation out of sync | Low | Medium | Auto-generate from code (Swagger decorators) |

## Parallel Development

**Can Run in Parallel**: YES (after Epic 005 + Epic 004 complete)
**Can Run Alongside**: Epic 007 (WebSocket Telemetry)

## Related ADRs

- Create ADR-024: REST vs. GraphQL for API layer
- Create ADR-025: JWT vs. session-based authentication
- Create ADR-026: Rate limiting strategy (IP vs. user-based)

## Notes

- REST API should be stable before building UI clients
- Swagger documentation is critical for developer experience
- Authentication must be bulletproof (this is the attack surface)
- Webhook signature validation prevents replay attacks
- Consider API versioning (v1, v2) for future compatibility
- Monitor API usage metrics (Epic 013)
