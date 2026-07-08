# EPIC-173: Large Service Decomposition and Responsibility Realignment

Status: Proposed
Priority: P2
Created: 2026-05-14
Last Updated: 2026-05-14
Owner: API + Kanban + Chat Platform
Depends On: EPIC-094, EPIC-123, EPIC-147, EPIC-170, EPIC-172
Related Analysis:
- `docs/analysis/ANALYSIS-codebase-review-2026-04-25.md`
- Refactor scan performed 2026-05-14

---

## 1. Summary

This epic decomposes large, multi-responsibility services into smaller application services, policy services, mappers, and handlers. The goal is not to split files mechanically. The goal is to restore Single Responsibility Principle boundaries so orchestration, chat, telegram command routing, mesh delegation, and session execution can evolve safely.

The scan found several hotspot files with high line counts, broad responsibilities, local policy decisions, and disabled max-line linting. These are high-friction areas for future changes and are likely to accumulate bugs because one class or function owns parsing, policy, persistence, transport, authorization context, event emission, and DTO shaping.

---

## 2. Problem Statement

Several important runtime paths are implemented as large services or functions. They are difficult to test in isolation and tend to hide multiple domains in one unit. This makes it easy to add more conditionals instead of creating explicit extension seams.

Refactoring these hotspots will make EPIC-170 and EPIC-172 easier to complete because orchestration and event policy can be moved to dedicated components instead of remaining embedded inside large service methods.

---

## 3. Hotspots and Evidence

### 3.1 Kanban orchestration service is too large

File:

- `apps/kanban/src/orchestration/orchestration.service.ts`

Observed structure:

- 1432 total lines.
- `OrchestrationService` spans roughly 330 lines.
- A standalone `project` function spans roughly 885 lines.
- Contains decision shaping helpers and projection logic in the same file.
- Contains an eslint disable for a type parameter near the bottom.

Why this is a problem:

- One file appears to mix persistence, orchestration view projection, decision parsing, status mapping, public DTO shaping, and command behavior.
- The 885-line `project` function is a major maintainability risk.
- Changes to orchestration projection or lifecycle policy require navigating a very large unit.

### 3.2 Telegram command router is a 407-line class

File:

- `apps/api/src/chat/channel-adapters/telegram/telegram-command-router.service.ts`

Observed structure:

- 428 total lines.
- `TelegramCommandRouterService` spans roughly 407 lines.
- Utilities already exist in `telegram-command-router.utils.ts`, which indicates extraction has started but the service remains a large coordinator.

Likely responsibilities currently mixed:

- Command parsing/selection.
- Authorization or allowed-user behavior.
- Session lookup/resume behavior.
- Metadata command handling.
- Approval command routing.
- Help/menu rendering.
- Telegram message sending.

### 3.3 Mesh delegation dispatch service is a 375-line class

Files:

- `apps/api/src/workflow/workflow-subagents/mesh-delegation-dispatch.service.ts`
- `apps/api/src/workflow/workflow-subagents/mesh-delegation.service.types.ts`

Observed structure:

- 405 total lines in dispatch service.
- Single class spans roughly 375 lines.
- Uses `MESH_DELEGATION_ACTIVE_STATUSES` from types.

Likely responsibilities currently mixed:

- Candidate discovery.
- Capacity checks.
- Active status policy.
- Dispatch command execution.
- State transition persistence.
- Audit/event emission.
- Error handling/retry behavior.

### 3.4 Chat execution and session services exceed lint limits

Files:

- `apps/api/src/chat-execution/chat-execution.service.ts`
- `apps/api/src/chat/chat-sessions/chat-sessions.service.ts`

Evidence:

- Both contain `/* eslint-disable max-lines */`.
- Prior analysis identified `ChatExecutionService` as mixing execution, in-flight state, allowed tools, and SDK allowlist conversion.
- `ChatSessionsService` is a large session application service and likely mixes persistence, context assembly, telemetry, and state transitions.

### 3.5 Additional large/complex test fixtures

Examples:

- `apps/api/src/chat/channel-adapters/telegram/telegram-command-router.service.spec.ts`
- `packages/pi-runner/src/session/session-factory.tools.spec.ts`

These are not production services but indicate missing typed fixture builders and domain-specific test helpers.

### 3.6 Kanban Core client mixes unrelated cross-service capabilities

File:

- `apps/kanban/src/core/core-workflow-client.service.ts`

Observed responsibilities:

- Constructs the Core base URL and HTTP options.
- Builds Kanban-to-Core service JWTs from env.
- Launches workflow runs.
- Reads workflow run status.
- Controls/cancels workflow runs.
- Retrieves secrets from Core/API.
- Emits event ledger entries.
- Emits Kanban domain events to Core/API.

This file is not large compared with the biggest services, but it is a responsibility hotspot. It is named as a workflow client while also handling secrets, event ledger, domain event publication, transport setup, and auth token construction. That makes consumers depend on more capabilities than they need and obscures the fact that Kanban owns Kanban state while Core/API owns workflow runtime, secrets, event ingestion, and event ledger storage.

---

## 4. Goals

1. Split large services by responsibility while preserving behavior.
2. Remove `/* eslint-disable max-lines */` from production files where feasible.
3. Introduce handler registries for command-style logic.
4. Extract projection/mapper code from application services.
5. Isolate policy decisions from transport and persistence code.
6. Add focused unit tests around each extracted component.
7. Reduce future change risk for EPIC-170/172 orchestration changes.

---

## 5. Non-Goals

1. Do not rewrite entire domains from scratch.
2. Do not change user-facing behavior unless tests identify existing bugs.
3. Do not split files into arbitrary tiny modules without responsibility boundaries.
4. Do not move orchestration authority back into Kanban service code.
5. Do not block EPIC-171 security fixes on this work.

---

## 6. Proposed Component Boundaries

### 6.1 Kanban orchestration decomposition

Target components:

| Component | Responsibility |
| --- | --- |
| `OrchestrationDecisionReader` | Parse and normalize stored orchestration decisions. |
| `OrchestrationTimelineProjector` | Build public timeline/projection entries. |
| `CycleStateProjector` | Convert cycle run state into public orchestration status. |
| `WorkItemRunMapper` | Link work items, workflow runs, and current execution metadata. |
| `OrchestrationCommandService` | Handle explicit commands/mutations. |
| `OrchestrationViewAssembler` | Compose final API response/view models. |
| `DecisionPolicyMetadataService` | Read canonical policy metadata, not decide workflow strategy. |

The existing `project` function should be broken apart first because it is the largest single unit.

### 6.2 Telegram command handler registry

Introduce a handler interface:

```ts
export interface TelegramCommandHandler {
  readonly command: TelegramCommand;
  canHandle(context: TelegramCommandContext): boolean;
  handle(context: TelegramCommandContext): Promise<void>;
}
```

Potential handlers:

- `TelegramHelpCommandHandler`
- `TelegramResumeCommandHandler`
- `TelegramMetadataCommandHandler`
- `TelegramApprovalCommandHandler`
- `TelegramSessionSelectionHandler`
- `TelegramUnknownCommandHandler`

Router responsibility after refactor:

1. Read inbound command.
2. Resolve command context.
3. Select handler.
4. Delegate.
5. Apply common error handling/logging.

### 6.3 Mesh delegation dispatch decomposition

Target components:

| Component | Responsibility |
| --- | --- |
| `MeshDelegationCandidateQuery` | Finds eligible delegation contracts. |
| `MeshDelegationCapacityPolicy` | Computes dispatch capacity and active counts. |
| `MeshDelegationDispatchExecutor` | Performs spawn/dispatch side effects. |
| `MeshDelegationStatusUpdater` | Persists status transitions and timestamps. |
| `MeshDelegationAuditPublisher` | Emits events/ledger entries. |
| `MeshDelegationDispatchCoordinator` | Coordinates the above components. |

Status groups should be imported from canonical policy metadata created by EPIC-172/174 if available.

### 6.4 Chat service decomposition

`ChatExecutionService` target components:

- `ChatTurnExecutionCoordinator`
- `ChatInFlightRegistry`
- `ChatToolPolicyResolver`
- `ChatSdkAllowlistMapper`
- `ChatExecutionTelemetryPublisher`

`ChatSessionsService` target components:

- `ChatSessionRepositoryAdapter`
- `ChatSessionContextAssembler`
- `ChatSessionStateService`
- `ChatSessionTelemetryService`
- `ChatSessionDtoMapper`

### 6.5 Kanban Core client decomposition

Split `CoreWorkflowClientService` by capability rather than by HTTP endpoint implementation detail:

| New component | Responsibility |
| --- | --- |
| `KanbanCoreHttpClient` | Shared transport wrapper and base URL handling. |
| `KanbanCoreAuthTokenProvider` | Static bearer-token or service-JWT authorization header creation. |
| `WorkflowRunClient` | Launch/read/control/cancel workflow runs. |
| `CoreSecretClient` | Retrieve secrets with explicit secret-read authorization. |
| `CoreEventLedgerClient` | Emit event ledger entries. |
| `KanbanDomainEventPublisher` | Publish Kanban domain facts/events to Core/API ingestion. |

Current consumers should receive the narrowest possible dependency. For example, `KanbanLifecycleEventPublisher` should not depend on workflow-run launch methods, and `ManagedProjectCloneService` should not depend on event ledger or workflow control methods just to retrieve a secret.

---

## 7. Implementation Plan

### Phase 1: Characterization tests

Before refactoring each hotspot, add tests that lock current behavior:

- Kanban orchestration projection cases.
- Telegram command routing for supported commands.
- Mesh delegation dispatch capacity/status behavior.
- Chat execution allowlist and in-flight behavior.

### Phase 2: Extract pure helpers and mappers

Start with low-risk pure functions:

- DTO mapping.
- status mapping.
- decision parsing.
- command parsing.
- allowlist mapping.

### Phase 3: Extract policies from coordinators

Move candidate/capacity/status policy into dedicated injectable services.

Also extract Kanban-to-Core authorization and event publication out of the broad Core client so persistence services do not hide best-effort cross-service side effects.

### Phase 4: Introduce registries and adapters

- Telegram command registry.
- Mesh delegation dispatch coordinator.
- Chat execution coordinator.

### Phase 5: Remove lint suppressions and enforce size budgets

- Remove production `/* eslint-disable max-lines */` when files are under threshold.
- Consider adding module-specific max-lines exceptions only for generated type files.

---

## 8. Testing Strategy

1. Snapshot/characterization tests before extraction.
2. Unit tests for each extracted pure mapper/helper.
3. Contract tests for command handlers.
4. Integration tests proving old public service methods still return equivalent results.
5. Mutation-path tests for mesh delegation and chat execution side effects.
6. Regression test ensuring `orchestration.service.ts` no longer contains an 800+ line function.

---

## 9. Dependencies

- EPIC-172 for canonical event/boundary direction.
- EPIC-170 for orchestration authority model.
- EPIC-174 for shared contracts and status metadata.

This epic can run in parallel with EPIC-174 for areas that do not depend on shared metadata. Avoid making policy extraction depend on incomplete architecture changes by preserving existing behavior behind smaller components first.

---

## 10. Acceptance Criteria

1. `apps/kanban/src/orchestration/orchestration.service.ts` no longer contains an 800+ line standalone function.
2. Kanban orchestration projection logic is covered by focused tests.
3. `TelegramCommandRouterService` delegates command behavior to handlers and is reduced to routing/context/error coordination.
4. Mesh delegation dispatch separates candidate query, capacity policy, dispatch execution, status persistence, and audit/event publishing.
5. Production `ChatExecutionService` and `ChatSessionsService` no longer need blanket `max-lines` disables, or remaining exceptions are documented with follow-up tasks.
6. Extracted services have unit tests and retain existing behavior.
7. No new direct hardcoded workflow/process policy is introduced during the splits.
8. `CoreWorkflowClientService` is replaced or reduced to a workflow-only adapter; secrets, event ledger, domain events, and auth token creation have separate named providers.

---

## 11. Definition of Done

- Refactored components compile and pass existing tests.
- New tests cover extracted behavior.
- Public APIs remain backward compatible unless a separate migration note is added.
- Large-service lint suppressions are removed where feasible.
- Architecture notes document the new component ownership boundaries.

---

## 12. Implementation Update (2026-05-15)

Status: In Progress

### Completed in this implementation slice

1. Telegram command router decomposition completed for command behavior delegation.
2. Kanban Core workflow client decomposition completed for capability separation.
3. Mesh delegation dispatch decomposition completed into coordinator + focused collaborator services.

### Changes delivered

#### Telegram command router decomposition

- Added a dedicated command handler contract (`TelegramCommandHandler`) and command context type.
- Extracted command behavior into focused handlers:
  - `TelegramHelpCommandHandler`
  - `TelegramNewCommandHandler`
  - `TelegramResumeCommandHandler`
  - `TelegramAgentCommandHandler`
- Reduced `TelegramCommandRouterService` responsibility to:
  1. command detection and guard checks
  2. shared context construction
  3. handler resolution/delegation
  4. common command message persistence/response relay
- Registered handlers in `ChannelAdaptersModule` for dependency injection.

#### Kanban Core client decomposition

- Moved event ledger payload contract into `core-client.types.ts` to remove circular coupling to the facade service.
- Extracted focused collaborators:
  - `KanbanCoreHttpClient`
  - `CoreWorkflowRunClientService`
  - `CoreSecretClientService`
  - `CoreEventLedgerClientService`
  - `KanbanDomainEventPublisherService`
- Refactored `CoreWorkflowClientService` into a compatibility facade over these collaborators.
- Preserved existing public API surface for current consumers while separating capabilities internally.

#### Mesh delegation dispatch decomposition

- Split dispatch responsibilities into dedicated collaborators:
  - `MeshDelegationCandidateQueryService`
  - `MeshDelegationCapacityPolicyService`
  - `MeshDelegationStatusUpdaterService`
  - `MeshDelegationAuditPublisherService`
  - `MeshDelegationDispatchExecutorService`
- Refactored `MeshDelegationDispatchService` into a coordinator over these collaborators.
- Kept public dispatch/sweep APIs stable while moving candidate lookup, capacity policy, execution side effects, state persistence, and audit/event emission out of the coordinator.
- Added focused unit coverage for coordinator behavior in `mesh-delegation-dispatch.service.spec.ts`.

### Validation run and results

1. Targeted tests passed:
   - `telegram-command-router.service.spec.ts`
   - `core-workflow-client.service.spec.ts`
  - `mesh-delegation-dispatch.service.spec.ts`
  - `mesh-delegation-governance.service.spec.ts`
2. Touched-file ESLint checks passed after local fixes.
3. `build:kanban` passed.
4. `build:api` failed due to repository-wide environment/dependency issues unrelated to this slice (`@opentelemetry/*` missing in current workspace state).
5. Workspace-wide `lint:api`, `lint:kanban`, `test:api`, and `test:kanban` remain failing due to large pre-existing violations outside touched EPIC-173 files.

### Decisions and rationale

1. Chose a vertical-slice approach instead of broad multi-domain rewrites to minimize risk and preserve behavior.
2. Kept `CoreWorkflowClientService` as a facade to avoid breaking existing dependency injection and call sites while still achieving responsibility separation.
3. Kept router-level duplicate command handling, message persistence, and response publishing as shared concerns while moving command-specific behavior to handlers.

### Remaining EPIC-173 scope after this slice

1. Kanban orchestration `project` function decomposition and projection mapper extraction.
2. Chat execution and chat sessions service decomposition and lint-disable removal (or explicit documented exceptions with tracked follow-up tasks).
3. Expanded characterization/integration tests for extracted orchestration and mesh components.

### Documented exceptions and follow-up tasks

1. `apps/api/src/chat-execution/chat-execution.service.ts` still uses a file-level `max-lines` disable.
  Follow-up: extract `ChatTurnExecutionCoordinator`, `ChatInFlightRegistry`, `ChatToolPolicyResolver`, and `ChatExecutionTelemetryPublisher` in the next EPIC-173 slice.
2. `apps/api/src/chat/chat-sessions/chat-sessions.service.ts` still uses a file-level `max-lines` disable.
  Follow-up: extract `ChatSessionRepositoryAdapter`, `ChatSessionContextAssembler`, `ChatSessionStateService`, and `ChatSessionDtoMapper` in the next EPIC-173 slice.
