# Epic 002: Core Infrastructure & Data Plane

## Overview

**Epic ID**: 002
**Layer**: Foundation
**Status**: Not Started
**Priority**: Critical (P0)
**Estimated Timeline**: 1 week

## Context

Establish the foundational data persistence and application infrastructure that all other services will build upon. This epic creates the base NestJS application scaffold, PostgreSQL schemas, Redis configurations, and core entity definitions. Without this foundation, no other services can be developed or tested.

This is the absolute starting point for the Nexus Core Engine - it provides the persistence layer, message queuing infrastructure, and application framework that every other epic depends on.

## Dependencies

**Upstream Dependencies**: None (this is the foundation)
**Downstream Dependencies**: All other epics (002-013) depend on this

## Scope

### Included in This Epic

- **NestJS Application Scaffold**
  - TypeScript configuration with strict mode
  - Project structure (modules, services, controllers)
  - Environment-based configuration management (.env files)
  - Logging infrastructure (Winston or Pino)
  - Health check endpoints

- **PostgreSQL Database Setup**
  - Database connection configuration (TypeORM or Prisma)
  - Migration system setup
  - Schema definitions for 5 core tables:
    - `Workflows` (id, name, yaml_definition, is_active)
    - `WorkflowRuns` (id, workflow_id, status, current_step_id, state_variables)
    - `ToolRegistry` (id, name, schema, typescript_code, tier_restriction)
    - `PiSessionTrees` (id, workflow_run_id, container_tier, jsonl_data, last_leaf_node_id)
    - `MemorySegments` (id, entity_type, entity_id, summary)
  - Connection pooling configuration
  - Database health monitoring

- **Redis Configuration**
  - Redis client setup
  - BullMQ queue configuration (bull:workflow_steps)
  - Redis Streams setup (stream:telemetry:{session_id})
  - Pub/Sub channel configuration
  - Redis health monitoring

- **Entity Models & Repositories**
  - TypeORM/Prisma entity definitions for all 5 tables
  - Repository pattern implementation
  - Base CRUD operations for each entity

- **Configuration Management**
  - Environment variable loading (.env, .env.development, .env.production)
  - Secret management setup (placeholder for Vault integration)
  - Configuration validation (required vars check on startup)

### Out of Scope

- Business logic services (WorkflowEngine, ContainerOrchestrator, etc.)
- API endpoints beyond health checks
- Container orchestration
- Workflow execution logic
- WebSocket/real-time communication

## Tasks

### Infrastructure Setup
- [ ] Initialize NestJS project with TypeScript strict mode
- [ ] Configure ESLint and Prettier for code quality
- [ ] Set up project folder structure (src/modules, src/common, src/config)
- [ ] Configure environment-based settings (ConfigModule)
- [ ] Set up logging infrastructure (Winston with structured JSON logs)
- [ ] Create health check module with /health endpoint

### PostgreSQL Setup
- [ ] Install and configure TypeORM or Prisma
- [ ] Create database connection module
- [ ] Set up migration system
- [ ] Create migration for Workflows table
- [ ] Create migration for WorkflowRuns table
- [ ] Create migration for ToolRegistry table
- [ ] Create migration for PiSessionTrees table
- [ ] Create migration for MemorySegments table
- [ ] Configure connection pooling (min: 2, max: 10 connections)
- [ ] Add database health check to /health endpoint

### Redis Setup
- [ ] Install Redis client library (ioredis)
- [ ] Create Redis connection module
- [ ] Configure BullMQ with bull:workflow_steps queue
- [ ] Set up Redis Streams for telemetry data
- [ ] Configure Pub/Sub channels
- [ ] Add Redis health check to /health endpoint
- [ ] Set up Redis connection retry logic

### Entity Models & Repositories
- [ ] Create Workflow entity with TypeORM/Prisma decorators
- [ ] Create WorkflowRun entity
- [ ] Create ToolRegistry entity
- [ ] Create PiSessionTree entity
- [ ] Create MemorySegment entity
- [ ] Implement repository pattern for each entity
- [ ] Add validation decorators (class-validator)
- [ ] Create database seeders for development data

### Testing & Documentation
- [ ] Write unit tests for entity models
- [ ] Write integration tests for database CRUD operations
- [ ] Write integration tests for Redis connectivity
- [ ] Write integration tests for BullMQ queue operations
- [ ] Document environment variables in README.md
- [ ] Create database schema diagram (ERD)
- [ ] Document setup instructions for local development

## Key Deliverables

1. **Working NestJS Application**
   - Boots without errors
   - Health check endpoint responds with 200 OK
   - Logs structured JSON to stdout

2. **Migrated PostgreSQL Database**
   - All 5 tables created with correct schemas
   - Indexes on foreign keys and commonly queried fields
   - Development seed data loaded

3. **Functional Redis Instance**
   - BullMQ queue can enqueue/dequeue jobs
   - Streams can XADD and XRANGE events
   - Pub/Sub channels functional

4. **Comprehensive Test Suite**
   - 100% of entity models tested
   - Database CRUD operations validated
   - Redis connectivity verified

5. **Documentation**
   - README.md with setup instructions
   - .env.example with all required variables
   - Database ERD diagram

## Acceptance Criteria

- [ ] NestJS application starts without errors (npm run start:dev)
- [ ] All database migrations execute successfully (npm run migration:run)
- [ ] All 5 PostgreSQL tables exist with correct schemas (verified with schema inspection)
- [ ] Redis connection is established and verified (health check passes)
- [ ] BullMQ queue can enqueue a test job and process it
- [ ] Redis Stream can XADD an event and retrieve it with XRANGE
- [ ] Environment variables are loaded from .env files correctly
- [ ] Health check endpoint returns 200 OK with status for DB and Redis
- [ ] All unit tests pass (100% of entity model tests)
- [ ] All integration tests pass (database CRUD, Redis ops)
- [ ] No TypeScript compilation errors (npm run build succeeds)
- [ ] No ESLint errors (npm run lint passes)

## Technical Notes

### Technology Stack
- **Framework**: NestJS v10+
- **Language**: TypeScript 5+ (strict mode)
- **ORM**: TypeORM or Prisma (recommend Prisma for better DX)
- **Database**: PostgreSQL 15+
- **Cache/Queue**: Redis 7+
- **Queue Library**: BullMQ v4+

### Database Schema Considerations
- Use UUID for all primary keys (better for distributed systems)
- Use JSONB for `state_variables` and `jsonl_data` (native PostgreSQL indexing)
- Add created_at and updated_at timestamps to all tables
- Use ENUM types for status fields (e.g., WorkflowRun.status)
- Add indexes on foreign keys and frequently queried fields

### Configuration Best Practices
- Never commit .env files to git (add to .gitignore)
- Use .env.example as a template with dummy values
- Validate required environment variables on application startup
- Use different .env files per environment (dev, staging, prod)

### Testing Strategy
- Unit tests: Entity validation, model methods
- Integration tests: Database connections, CRUD operations, Redis ops
- Use test database (separate from development DB)
- Clean up test data after each test run
- Mock external dependencies in unit tests

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| PostgreSQL version incompatibility | High | Low | Pin PostgreSQL version in docker-compose.yml |
| Redis connection instability | Medium | Medium | Implement retry logic with exponential backoff |
| Migration conflicts during development | Medium | Medium | Use timestamped migrations, clear naming conventions |
| JSONB performance at scale | Medium | Low | Add GIN indexes on JSONB columns, monitor query performance |

## Parallel Development

**Can Run in Parallel**: NO
**Reason**: This is the foundation - all other epics depend on it being complete first.

## Related ADRs

- Create ADR-001: Choice of NestJS as orchestration framework
- Create ADR-002: PostgreSQL vs. other relational databases
- Create ADR-003: TypeORM vs. Prisma for ORM layer
- Create ADR-004: BullMQ for job queue management

## Notes

- This epic must be 100% complete before any other epic can begin
- Focus on stability and correctness over speed
- Set up good testing patterns here - they'll be replicated in all other epics
- Database schema changes after this point require migrations
