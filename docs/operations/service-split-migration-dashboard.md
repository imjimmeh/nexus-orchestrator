# Service Split Migration Dashboard

Tracks delivery and dependency progression for service-split epics.

## Epic Progress

| Epic     | Theme                                     | Status                                              | Depends On                             | Notes                                                                                                                                                                                                                                                                                         |
| -------- | ----------------------------------------- | --------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EPIC-088 | Foundations and guardrails                | Completed                                           | None                                   | Dependency baseline + boundary tests + workspace scaffolds.                                                                                                                                                                                                                                   |
| EPIC-089 | Shared contracts and service clients      | Completed                                           | EPIC-088                               | Canonical versioned contracts in `packages/core`.                                                                                                                                                                                                                                             |
| EPIC-090 | Core decoupling and extension boundaries  | Implemented (deterministic E2E deferred by request) | EPIC-088, EPIC-089                     | Domain ports, special-step registry seams, and core internal workflow routes are live.                                                                                                                                                                                                        |
| EPIC-091 | Kanban extraction and compatibility proxy | Implemented (no compatibility proxy by request)     | EPIC-088, EPIC-089, EPIC-090           | Kanban modules + core integration + projection ingestion are live in `apps/kanban`.                                                                                                                                                                                                           |
| EPIC-092 | Chat bootstrap and ingress                | Implemented                                         | EPIC-088, EPIC-089, EPIC-090           | Chat session/message APIs and Telegram ingress are now hosted in `apps/api` (`src/chat/*`).                                                                                                                                                                                                   |
| EPIC-093 | Chat memory lifecycle                     | Implemented                                         | EPIC-092                               | Chat memory lifecycle, distillation, and observability are now hosted in `apps/api` (`src/chat/memory/*`).                                                                                                                                                                                    |
| EPIC-094 | Cutover and hardening                     | In Progress                                         | EPIC-090, EPIC-091, EPIC-092, EPIC-093 | Split-profile compose, service JWT scopes, correlation propagation, runtime contract validation, doctor split-service connectivity checks, web service-aware endpoint routing, and default-disabled API legacy chat fallback are implemented; canary windows and final legacy removal remain. |

## Event Transport Map

| Flow                                                                     | Contract Envelope                | Transport                                         | Status               | Notes                                                                                                                    |
| ------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Core (`apps/api`) -> Kanban (`apps/kanban`) lifecycle projection updates | `CoreWorkflowRunEventEnvelopeV1` | Push (`POST /internal/core/events` on kanban)     | Implemented          | Emitted from internal core workflow run service and fanned out best-effort when `KANBAN_SERVICE_BASE_URL` is configured. |
| Kanban -> Core work-item events                                          | `KanbanWorkItemEventEnvelopeV1`  | Push (`POST /internal/kanban/events` on core API) | Receiver implemented | Endpoint is now available in `apps/api`; producer adoption and downstream consumers remain in backlog.                   |
| Chat runtime (`apps/api/src/chat`) -> Core event ledger                  | `ChatEventEnvelopeV1`            | In-process publish + internal API handlers        | Implemented          | Chat runtime is colocated with core API; envelope schema remains versioned for compatibility and future extraction.      |

## Dependency Rules

1. Do not begin implementation work on an epic until all listed dependencies are complete and quality gates pass.
2. Every epic must carry forward:
   - architecture guardrail coverage
   - shared contract compatibility checks
   - rollback path updates
3. Exception allowlists must trend downward after EPIC-090 starts.

## Blocking Conditions

1. New cross-domain import without an approved temporary exception.
2. Contract compatibility tests fail in `packages/core` or consumer suites.
3. Lint/test/build regressions in touched workspaces.
4. Docker split-topology smoke check fails for active services.

## Rollback Triggers

1. Deterministic orchestration behavior drift in kanban/chat integration suites.
2. Contract parsing failures at internal service boundaries.
3. Sustained startup failure from missing registry/port wiring.
