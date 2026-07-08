---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: api-core
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/main.ts
  - apps/api/src/app.module.ts
  - apps/api/src/config/validation.schema.ts
  - apps/api/src/common/all-exceptions.filter.ts
  - apps/api/src/common/logger.config.ts
  - apps/api/src/database/database.module.ts
  - apps/api/src/database/typeorm-api.logger.ts
  - apps/api/src/common/request-context.service.ts
  - apps/api/src/common/correlation-id.middleware.spec.ts
  - apps/api/src/common/all-exceptions.filter.spec.ts
  - apps/api/src/common/logger.config.spec.ts
  - apps/api/src/config/validation.schema.spec.ts
source_paths:
  - apps/api/src/common
  - apps/api/src/config
  - apps/api/src/database
  - apps/api/src/main.ts
  - apps/api/src/app.module.ts
updated_at: 2026-05-22T00:00:00.000Z
---

# Probe Result: Core API Infrastructure

## Narrative Summary

The Core API Infrastructure (probe `api-core`) for project `458935f0-213e-4bbe-89d1-8883e0efa9ad` is **fully implemented** and well-structured. The NestJS application bootstraps with OpenTelemetry tracing, Winston-structured logging with AsyncLocalStorage-based request context injection, Swagger documentation, CORS configuration, global Zod validation via `ZodValidationPipe`, a global `AllExceptionsFilter`, a throttling guard, and a `CorrelationIdMiddleware` that propagates `X-Request-ID`, `X-Correlation-ID`, and `X-Causation-ID` headers. The `AppModule` orchestrates approximately 28 feature modules covering the full platform surface. The database layer uses TypeORM with a typed entity registry, migration management, seed services (agents, LLMs, roles, skills, workflows, etc.), and a custom `TypeOrmApiLogger`. Configuration is enforced via a Zod `envSchema` that validates all security-sensitive runtime values (JWT secrets, DB credentials, Redis, CORS origin) at startup.

## Capability Updates

- **Bootstrap & Runtime**: `main.ts` initializes OTel SDK before the Nest application, sets global `/api` prefix, Swagger at `/docs`, CORS (respecting `CORS_ORIGIN` env var), the `ZodValidationPipe`, and starts on the configured `PORT`.
- **Module Architecture**: `AppModule` is the root NestJS module — all feature modules are imported with proper dependency order. A `StartupSeedService` runs on `onModuleInit` and seeds agents, LLMs, roles, permissions, skills, tool approval rules, and workflows.
- **Database**: `DatabaseModule` registers ~63 entities and repositories with a single TypeORM `forRootAsync` connection to PostgreSQL. Migrations are gated by `TYPEORM_MIGRATIONS_RUN`. The custom `TypeOrmApiLogger` formats slow query and error logs with parameters.
- **Validation Schema**: `validation.schema.ts` enforces minimum lengths for JWT secrets and encryption keys, requires CORS origin and all DB/Redis connection details, and defines sensible defaults for JWT expiry, password policy, rate limiting, and port.
- **Correlation & Context**: `CorrelationIdMiddleware` (from `@nexus/core`) bridges incoming headers and generates UUIDs. `RequestContextService` extends `BaseRequestContextService` and initializes the `RequestContextLogger` bridge via `OnModuleInit`.
- **Exception Handling**: `AllExceptionsFilter` normalizes Postgres `22P02` (invalid text representation) to 400 BadRequest responses, exposes request IDs in error responses, and logs 5xx errors with stack traces.
- **Logging**: `logger.config.ts` configures Winston with console (pretty-printed, colorized) and two file transports (`logs/error.log`, `logs/combined.log`). The `requestContextFormat` injects `requestId`, `userId`, and `workflowRunId` from AsyncLocalStorage into every log entry.

## Health Findings

- **Test Coverage**: Tests exist for `all-exceptions.filter.ts`, `logger.config.ts`, `validation.schema.ts`, and `correlation-id.middleware.spec.ts`. No direct unit/integration test for `main.ts` bootstrap or `app.module.ts` wiring — coverage is inferred from E2E tests under `apps/api/test/`.
- **E2E Test Suite**: `apps/api/test/` contains ~15 E2E spec files covering workflows, kanban lifecycle, event ledger, sessions, chat, tool validation, and project orchestration. These exercise the full application stack including database, Redis, Docker, MCP, and auth boundaries.
- **Database Migrations**: 8 migration files exist under `apps/api/src/database/migrations/`, including a post-cutover baseline spec and runtime feedback, plugin registry, and tool registry metadata migrations. Migrations are registered via `registered-migrations.ts`.
- **Code Quality**: The codebase uses TypeScript strict mode, NestJS DI, typed Zod schemas for all environment variables, and consistent error response shapes `{ success: false, error: { code, message, details, timestamp, requestId } }`.
- **No Churn Signals**: The infrastructure files are stable with no recent churn indicators.

## Open Questions

- No direct unit test for `main.ts` bootstrap (though E2E specs cover the running application).
- `AppModule` imports are tightly coupled — adding a new feature module requires manual import in this file; no dynamic/feature-flagged module loading.
- Seed services run on every module init (`onModuleInit`); in multi-instance deployments this could cause race conditions unless seeding is idempotent. The idempotency of individual seed services is not verified from code alone.
- The Kanban lifecycle E2E tests (`kanban-lifecycle-deterministic.e2e-spec.ts`, `phase*.test.ts`) live outside `apps/api/test/` in `packages/e2e-tests` — this split means API-level kanban integration coverage is E2E-only.