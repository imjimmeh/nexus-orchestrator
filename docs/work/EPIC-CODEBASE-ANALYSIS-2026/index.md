# EPIC: Codebase Analysis & Improvement Roadmap

> Status: in_progress
> Priority: high
> Created: 2026-04-25
> Owner: Jimmeh

---

## Purpose

Comprehensive analysis of the nexus-orchestator codebase to identify refactoring opportunities, architectural improvements, code quality issues, and the next best features to add.

---

## Background

As the codebase has grown across multiple apps (api, kanban, web) and packages (core, pi-runner, agent-local), areas of technical debt, duplication, and architectural inconsistency have accumulated. This Epic captures the full analysis and resulting recommendations.

---

## Scope

This Epic covers analysis and documentation only. No implementation changes are in scope.

### In Scope

- Code quality review: duplication, anti-patterns, inconsistent conventions
- Architectural review: SOLID violations, coupling, module boundaries
- Feature recommendations: agent autonomy, kanban/dev workflow improvements, user-facing features
- Identification of refactoring priorities

### Out of Scope

- Implementation of any changes identified

---

## Analysis Tasks

| # | Task | Agent | Status |
|---|------|-------|--------|
| 1 | Code quality & duplication review | code-reviewer | complete |
| 2 | Architectural soundness review | system-architect | complete |
| 3 | Technical debt & root cause analysis | root-cause-analyser | complete |
| 4 | Feature recommendations synthesis | documentation-writer | complete |

---

## Results

Full findings: [docs/analysis/ANALYSIS-codebase-review-2026-04-25.md](../../analysis/ANALYSIS-codebase-review-2026-04-25.md)

**Summary:**

- 1 critical security issue (hardcoded JWT secret in 7 production files)
- 3 additional high-severity security issues (scope guard bypass, WebSocket CORS wildcard, encryption key reuse)
- 1 critical logic bug (`assertRoleClaims` uses `||` instead of `&&` in kanban auth guard)
- 4 high-severity correctness issues (in-process locks, silent error swallowing, N+1 state writes, TypeORM synchronize)
- 7 duplication clusters across middleware, services, and types
- 10 high-risk services with no test coverage
- 10 feature recommendations across agent autonomy, user functionality, and kanban/dev workflow

---

## Worklog

### Task 1: Code Quality Review — Complete

- 7 duplication clusters identified (middleware, services, error classification, payload utils)
- 77 services missing specs; 10 high-risk gaps flagged
- `any` type usage pervasive in `packages/pi-runner` tool abstractions
- Critical logic bug in kanban auth guard: `||` vs `&&` in role check
- `WarRoomService` entirely in-memory with no spec

### Task 2: Architectural Review — Complete

- Hardcoded JWT secret fallback in 7 production files (critical)
- WebSocket CORS wildcard bypasses REST CORS policy
- `SECRET_ENCRYPTION_KEY` falls back to `JWT_SECRET` (key reuse)
- `InternalServiceScopeGuard` inspects claims before verifying signature
- Two in-process lock maps invalid under horizontal scaling
- `WorkflowModule` ↔ `ProjectModule` circular dependency (forwardRef)
- apps/kanban role ambiguity (BFF proxy vs domain authority)
- EventEmitter2 in-process only — multi-replica scaling gap

### Task 3: Technical Debt Analysis — Complete

- Dual `IWorkflowStep`/`IJob` type hierarchy with `as unknown as` casts
- Per-job sequential DB writes create N+1 pattern with race window
- `synchronize: true` active in dev/test alongside migrations system
- `StateMachineService` silently swallows condition evaluation errors
- Redis/CORS vars absent from startup validation schema; `validateEnv` never called
- Deprecated `register_tool` job type still in active seed workflows
- `ApiClient` uses `Object.assign` prototype mixin breaking static type safety
- Three independent `WorkflowRunStatus` definitions; undocumented `STARTING` status in frontend

### Task 4: Feature Recommendations — Complete

- FEAT-01: Structured agent feedback loop (self-improvement)
- FEAT-02: Workflow auto-optimiser (telemetry-driven YAML patches)
- FEAT-03: Dynamic model selection per step (`model: auto`)
- FEAT-04: Agent capability introspection (`list_capabilities` tool)
- FEAT-05: Natural language → workflow YAML generator
- FEAT-06: Real-time cost & token dashboard
- FEAT-07: Webhook/notification system
- FEAT-08: Git integration (issues → work items)
- FEAT-09: Autonomous PR review agent
- FEAT-10: Dependency-aware sprint planning
