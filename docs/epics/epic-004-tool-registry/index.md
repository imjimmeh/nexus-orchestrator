# Epic 004: Tool Registry & Dynamic Extension System

## Overview

**Epic ID**: 004
**Layer**: Foundation
**Status**: Not Started
**Priority**: Critical (P0)
**Estimated Timeline**: 1 week

## Context

Implement the dynamic tool management system that allows custom tools to be registered, validated, and mounted into Pi Agent containers. This system enables the Nexus platform to extend Pi Agent capabilities through TypeScript-based tools, enforce tier-based access control, and validate tool code for safety before execution.

The Tool Registry is a core security and extensibility mechanism. It ensures that agents only have access to tools appropriate for their role (e.g., QA agents can't merge PRs), and that all tool code is validated before being made available to AI agents.

## Dependencies

**Upstream Dependencies**:

- Epic 002 (Core Infrastructure) - for ToolRegistry table and database

**Downstream Dependencies**:

- Epic 009 (REST API) - exposes tool CRUD endpoints
- Epic 010 (Pi Agent Integration) - consumes tools via volume mounts
- Epic 012 (Security & IAM) - enforces tier-based access control

## Scope

### Included in This Epic

- **ToolRegistryService Implementation**
  - Tool CRUD operations (Create, Read, Update, Delete)
  - Tool retrieval by agent profile/tier
  - Tool versioning support
  - Tool activation/deactivation

- **Tool Code Validation**
  - TypeScript AST parsing and validation
  - Syntax error detection
  - Malicious code pattern detection (e.g., require('fs'), process.exit())
  - Schema validation (JSON Schema for tool parameters)

- **Tool Mounting System**
  - Write validated TypeScript files to temporary host directories
  - Generate proper CommonJS/ESM module exports
  - Create index.ts for tool discovery
  - Cleanup temporary directories after container shutdown

- **Tier-Based Access Control**
  - Define tier restrictions (Light, Heavy, Admin)
  - Enforce access control at tool retrieval time
  - Prevent unauthorized tool mounting

- **Built-in Tool Seeding**
  - Seed essential built-in tools on application startup:
    - `read` - Read file contents
    - `write` - Write file contents
    - `edit` - Edit file with search/replace
    - `bash` - Execute bash commands
    - `git_commit` - Create Git commits
    - `git_push` - Push to remote repository
    - `spawn_subagent` - Spawn child agent (Heavy tier only)

- **Tool Schema Management**
  - JSON Schema validation for tool parameters
  - Schema versioning
  - Schema evolution support

### Out of Scope

- Container provisioning (Epic 003)
- Tool execution (Pi Agent responsibility)
- Workflow-based tool injection (Epic 005)
- Tool usage analytics (Epic 013)
- Tool marketplace/discovery UI

## Tasks

### ToolRegistryService Core

- [ ] Create ToolRegistryService class
- [ ] Implement createTool() method
  - Accept: name, description, typescript_code, schema, tier_restriction
  - Validate TypeScript code (AST parsing)
  - Validate JSON Schema
  - Store in ToolRegistry table
- [ ] Implement getTool(id) method
- [ ] Implement getAllTools() method with filtering
- [ ] Implement updateTool(id, updates) method with versioning
- [ ] Implement deleteTool(id) method (soft delete recommended)
- [ ] Implement getToolsForProfile(profile) method
- [ ] Implement getToolsForTier(tier) method

### TypeScript Code Validation

- [ ] Install TypeScript compiler API (typescript package)
- [ ] Create ToolValidationService
- [ ] Implement AST parsing for TypeScript code
- [ ] Detect syntax errors and return detailed error messages
- [ ] Implement malicious pattern detection:
  - Block: require('fs'), require('child_process'), process.exit()
  - Block: eval(), Function() constructor
  - Block: network operations (http, https, net)
  - Allow: safe operations (string manipulation, JSON, etc.)
- [ ] Add validation result caching for performance
- [ ] Return validation errors with line numbers

### JSON Schema Validation

- [ ] Install JSON Schema validator (ajv package)
- [ ] Implement schema validation for tool parameters
- [ ] Validate schema format (must be valid JSON Schema Draft-07)
- [ ] Support common schema patterns (strings, numbers, objects, arrays)
- [ ] Return schema validation errors with paths

### Tool Mounting System

- [ ] Create ToolMountingService
- [ ] Implement mountToolsForContainer(containerId, tools) method
  - Create temporary directory: /tmp/nexus-tools-{containerId}/
  - Write each tool as TypeScript file: {toolName}.ts
  - Generate index.ts with exports for all tools
  - Return mount path for volume binding
- [ ] Implement generateToolExport(tool) method
  - Generate proper TypeScript module structure
  - Include tool metadata (name, description, schema)
  - Export as CommonJS or ESM based on configuration
- [ ] Implement cleanupToolMount(containerId) method
  - Remove temporary directory
  - Verify removal (error handling)
- [ ] Add file system permission checks
- [ ] Test mounting with various tool types

### Tier-Based Access Control

- [ ] Define tier enum (Light, Heavy, Admin)
- [ ] Add tier_restriction column to ToolRegistry table (migration)
- [ ] Implement tier filtering in getToolsForTier()
- [ ] Create tier-to-profile mapping configuration
  - Light: basic tools only (read, write)
  - Heavy: all development tools (bash, git_commit, git_push)
  - Admin: administrative tools (spawn_subagent, system_config)
- [ ] Validate tier restrictions during tool mounting
- [ ] Log access control violations for audit

### Built-in Tool Seeding

- [ ] Create tool seed data files (JSON or TypeScript)
- [ ] Implement database seeder for built-in tools
- [ ] Define built-in tools:
  - **read**: Read file contents from workspace
  - **write**: Write content to file
  - **edit**: Edit file with search/replace
  - **bash**: Execute bash commands in container
  - **git_commit**: Create Git commit
  - **git_push**: Push to remote Git repository
  - **spawn_subagent**: Spawn child agent (Heavy tier only)
- [ ] Run seeder on application startup (if tools don't exist)
- [ ] Add idempotency (don't duplicate tools on restart)
- [ ] Test seeded tools are correctly mounted

### Versioning & Evolution

- [ ] Add version column to ToolRegistry table
- [ ] Implement tool versioning on updates (increment version)
- [ ] Support rollback to previous tool version
- [ ] Add updated_at timestamp tracking
- [ ] Implement version history query

### Testing & Documentation

- [ ] Write unit tests for ToolRegistryService CRUD
- [ ] Write unit tests for TypeScript validation
  - Valid TypeScript → success
  - Syntax errors → failure with error message
  - Malicious patterns → rejection
- [ ] Write unit tests for JSON Schema validation
- [ ] Write integration tests for tool mounting
  - Create temp directory
  - Write TypeScript files
  - Verify file contents
  - Cleanup after test
- [ ] Write integration tests for tier access control
- [ ] Document tool creation API
- [ ] Create tool development guide for users
- [ ] Document built-in tools and their schemas

## Key Deliverables

1. **ToolRegistryService**
   - Full CRUD API for tools
   - Tier-based filtering
   - Versioning support

2. **Tool Validation Pipeline**
   - TypeScript AST validation
   - Malicious pattern detection
   - JSON Schema validation

3. **Tool Mounting System**
   - Temporary directory creation
   - TypeScript file generation
   - Cleanup logic

4. **Built-in Tools**
   - 7 essential tools seeded
   - Proper tier restrictions applied
   - Tested and validated

5. **Documentation**
   - Tool creation API docs
   - Tool development guide
   - Built-in tools reference

## Acceptance Criteria

- [ ] Tools can be created via ToolRegistryService.createTool()
- [ ] TypeScript code validation rejects malformed code with error details
- [ ] Malicious patterns are detected and rejected (require('fs'), eval(), etc.)
- [ ] JSON Schema validation enforces proper parameter schemas
- [ ] Tool schema validation rejects invalid JSON Schemas
- [ ] Tier restrictions prevent QA agents from accessing admin tools
- [ ] getToolsForTier('Light') returns only Light tier tools
- [ ] getToolsForTier('Heavy') returns Light + Heavy tier tools
- [ ] Tools can be updated and version is incremented
- [ ] Tool deletion marks as inactive (soft delete)
- [ ] Tool mounting creates temp directory with TypeScript files
- [ ] Generated TypeScript files have valid syntax
- [ ] Built-in tools (7 total) are seeded on application startup
- [ ] Seeder is idempotent (doesn't duplicate tools on restart)
- [ ] Unit tests cover CRUD operations (100% coverage)
- [ ] Integration tests verify AST validation with real TypeScript compiler
- [ ] Integration tests verify tool mounting filesystem operations
- [ ] Filesystem cleanup removes temp directories after use
- [ ] No temp directory leaks after test runs

## Technical Notes

### Technology Stack

- **TypeScript Compiler**: typescript package (for AST parsing)
- **JSON Schema Validator**: ajv v8+
- **ORM**: TypeORM/Prisma (from Epic 002)

### Tool TypeScript Template

```typescript
// Generated tool file: read.ts
export const tool = {
  name: "read",
  description: "Read file contents from workspace",
  schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to file" },
    },
    required: ["file_path"],
  },
  execute: async (params: { file_path: string }) => {
    // Tool implementation
    const fs = require("fs").promises;
    return await fs.readFile(params.file_path, "utf-8");
  },
};
```

### Tier Restriction Matrix

| Tool           | Light | Heavy | Admin |
| -------------- | ----- | ----- | ----- |
| read           | ✓     | ✓     | ✓     |
| write          | ✓     | ✓     | ✓     |
| edit           | ✗     | ✓     | ✓     |
| bash           | ✗     | ✓     | ✓     |
| git_commit     | ✗     | ✓     | ✓     |
| git_push       | ✗     | ✓     | ✓     |
| spawn_subagent | ✗     | ✗     | ✓     |

### Malicious Pattern Detection

Block these patterns:

- `require('fs')` - Direct filesystem access
- `require('child_process')` - Process spawning
- `require('http')`, `require('https')`, `require('net')` - Network access
- `eval()`, `Function()` - Dynamic code execution
- `process.exit()` - Process termination
- `process.env` - Environment variable access (secrets)

### Temporary Directory Structure

```
/tmp/nexus-tools-{containerId}/
  ├── index.ts              # Main export file
  ├── read.ts         # Individual tool files
  ├── write.ts
  └── bash.ts
```

### Security Considerations

- **Code Injection**: AST validation prevents most injection attacks
- **Path Traversal**: Validate all file paths in tool execution
- **Resource Exhaustion**: Add tool execution timeouts (Epic 010)
- **Secret Leakage**: Never include secrets in tool code

### Testing Strategy

- **Unit Tests**: Mock database, test business logic
- **Integration Tests**: Real database, real filesystem operations
- **Validation Tests**: Test with actual malicious code samples
- **Cleanup Tests**: Verify no temp directory leaks

## Risks & Mitigation

| Risk                                         | Impact | Probability | Mitigation                                        |
| -------------------------------------------- | ------ | ----------- | ------------------------------------------------- |
| Malicious code bypasses validation           | High   | Low         | Multiple validation layers, whitelist approach    |
| Tool code injection vulnerabilities          | High   | Low         | AST validation, sandboxed execution in containers |
| Filesystem permission errors during mounting | Medium | Medium      | Document required permissions, validate paths     |
| Tool versioning conflicts                    | Medium | Low         | Semantic versioning, rollback support             |
| Temp directory cleanup failures              | Low    | Medium      | Scheduled cleanup job, monitoring                 |

## Parallel Development

**Can Run in Parallel**: YES (after Epic 002 completes)
**Can Run Alongside**: Epic 003 (Docker Orchestration)

## Related ADRs

- Create ADR-008: Tool validation strategy (AST vs. sandboxed execution)
- Create ADR-009: Tool storage format (TypeScript vs. JSON DSL)
- Create ADR-010: Tier-based access control model

## Notes

- Tool validation is critical for security - invest time here
- Built-in tools should cover 80% of common agent needs
- Consider adding tool usage analytics later (Epic 013)
- Tool mounting should be fast (<100ms per container)
- Document the tool development workflow clearly for future contributors
