# EPIC: Static Code Analysis — Refactoring Opportunities (June 2026)

> Status: complete
> Priority: high
> Created: 2026-06-08
> Owner: Jimmeh

---

## Purpose

Fresh static code analysis of the nexus-orchestator monorepo to identify the highest-value refactoring targets as of June 2026. The codebase has evolved significantly since the April 2026 analysis (see EPIC-CODEBASE-ANALYSIS-2026), with new features added, lint fixes applied, and ongoing development across the api, web, kanban, and repair-agent apps.

---

## Background

The monorepo spans 5 apps (api, web, kanban, repair-agent, chat) and 8 packages. The April 2026 analysis identified critical security issues and architectural smells, many of which may still be present or may have introduced new patterns. This new analysis focuses specifically on refactoring value: identifying code that is hardest to maintain, most coupled, most duplicated, or most at risk.

---

## Scope

Analysis and documentation only. No implementation changes are in scope.

### In Scope

- Code complexity hotspots (functions > 14 cyclomatic complexity, files > 300 lines)
- Duplication clusters across apps and packages
- Tight coupling and violated SOLID principles
- Poor separation of concerns (business logic in wrong layers)
- Inconsistent patterns (same problem solved differently in different places)
- Dead code and unused exports
- Architectural smells (circular deps, God objects, anemic domain models)
- TypeScript anti-patterns (`any` overuse, unsafe casts, missing types)

### Out of Scope

- Implementation of any refactoring changes
- New feature work

---

## Analysis Tasks

| # | Task | Agent | Status |
|---|------|-------|--------|
| 1 | Code quality, duplication & complexity review | code-reviewer | complete |
| 2 | Architectural soundness & SOLID violations | system-architect | complete |
| 3 | Technical debt root causes & coupling analysis | root-cause-analyser | complete |

---

## Results

Full findings: [docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md](../../analysis/ANALYSIS-refactoring-opportunities-2026-06.md)

**Top 5 critical findings:**

1. Auth endpoints (`/login`, `/register`, `/refresh`) receive no runtime validation — Zod schemas exist but are not wired to `ZodValidationPipe`
2. `ChatExecutionService` (834 lines, zero tests) is the highest-risk file — 9 distinct responsibilities, hardcoded Docker hostnames, unsafe error handling in the retry path
3. `InMemoryDomainEventOutboxStore` is the only outbox implementation — defeats the delivery-guarantee of the pattern on any process restart
4. 134 unsafe `(error as Error).message` casts across production, alongside an `ErrorEnvelope` type in `packages/core` used in only 13 locations
5. Cross-cutting constants duplicated 3–7× (`normalizeOptionalString` ×7, `isTerminalWorkflowRunStatus` ×5, exponential backoff ×5, `MemoryType` ×5) with no canonical source of truth

---

## Worklog

### Task 1: Code Quality Review — Complete

- `normalizeOptionalString` pure function has 7 independent private/local copies across api and kanban
- `applyPagination`/`applySort`/`applySearch` helpers in `query-helpers.ts` have zero callers despite 4 repositories duplicating the logic inline
- 131 `as unknown as X` double-casts and 134 unsafe `(error as Error).message` patterns in production
- Exponential backoff computed 5 times with inconsistent clamping — different retry behaviour across subsystems
- `apps/web/src/lib/api/types.ts` is 2,063 lines imported by 282 files — domain-splitting is high-value, medium-effort
- Dead code confirmed: `pauseContainer`/`resumeContainer` (deprecated, zero callers), `PluginEventDeliveryObservabilityService` deprecated methods, `BoardStateService.getBoardStateSummary` always returns hardcoded zeros

### Task 2: Architectural Review — Complete

- `ChatExecutionService` (13 constructor params) and `WorkflowModule` (`@Global()`, 35+ providers) are the two most severe SRP violations
- `DatabaseModule` is `@Global()` with 55 entities and 58 repositories — eliminates all data-access boundary enforcement
- Confirmed circular deps: `MemoryModule` ↔ `LearningModule` and `WorkflowRuntimeCapabilityExecutorService` ↔ `WorkflowRuntimeToolsService`; 5 skipped kernel spec tests acknowledge more
- `CapabilityPreflightService` defined in `tool/` but imported via direct file path by `WorkflowModule` and `WorkflowStepExecutionModule` — no single-ownership
- `packages/core` contains a concrete HTTP client and NestJS middleware — violates the purpose of a types/interfaces package
- 5 fragmented tool sub-domains (`tool/`, `tool-registry/`, `tool-runtime/`, `capability-infra/`, `capability-governance/`) represent one bounded context with no coherent module boundary

### Task 3: Technical Debt Root Cause Analysis — Complete

- **Root cause 1**: No shared error utility — `ErrorEnvelope` designed but never mandated; 218 raw `throw new Error()` and 134 unsafe casts result
- **Root cause 2**: `strictPropertyInitialization: false` on api and kanban — inconsistent with `packages/core`'s `strict: true`; normalised `as unknown as` patterns as a workaround
- **Root cause 3**: No single source of truth for cross-cutting constants — every developer authors a local copy instead of a canonical one
- **Root cause 4**: In-memory state used for durable concerns (domain event outbox, event dedup, OAuth sessions, workflow ID cache, browser sessions)
- **Root cause 5**: Validation architecture has a silent opt-out path — `ZodValidationPipe` fires only on class-based DTOs; type-alias DTOs (including all auth endpoints) bypass it completely
- `apps/kanban/src/orchestration/orchestration.service.ts` — 49 revisions in 30 days, highest churn, `.catch(() => null)` on critical path
