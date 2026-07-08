# Execution Provider/Model Observability + Unified Agent-Execution Record

- **Date:** 2026-06-13
- **Status:** Design approved, pending spec review
- **Author:** Jimmeh (with Claude)
- **Branch:** `feat/execution-provider-model-observability`

## Problem

Operators cannot see which AI provider + model actually handled a given piece of
work — a workflow run, a workflow step, a chat session/turn, or an event. The
information exists at execution time but is not durably recorded for most paths.

This blocks four concrete needs, all of which were called out as drivers:

1. **Debugging / observability** — "why did this run use the wrong model?"
2. **At-a-glance transparency** — operators glancing at a run/chat want the model in play.
3. **Cost / usage attribution** — tie spend to provider+model per run/session.
4. **Audit / compliance** — an immutable record of which provider+model ran each unit of work.

### Current state (why the gap exists)

| Path                   | Resolved provider/model today                                                                 | Persisted?                        |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- |
| Chat session           | Stored on `chat_sessions.provider` / `.model` at **session creation** (coarse, session-level) | Yes (but not per-turn)            |
| Workflow step          | Resolved on the fly into `HarnessRuntimeConfig`, shipped to container via Redis               | **No — discarded**                |
| Job / execution        | —                                                                                             | No                                |
| Event (`event_ledger`) | —                                                                                             | No (generic `payload` JSONB only) |

Resolution precedence (per `CLAUDE.md`): workflow step override → agent profile from
DB → DB default model for use case → env fallback. Implemented in
`apps/api/src/ai-config/ai-configuration.service.ts` and applied in
`apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts`.
The resolved result is **ephemeral** for every path except chat-session creation.

### Secondary problem: two divergent "an agent ran" representations

`chat_sessions` is a persistent metadata row carrying provider/model/system_prompt/
agent_profile. Workflow steps have no equivalent row. The user's instinct was
"workflows should use chat sessions." Investigation showed the _literal_ version is
wrong — a chat session is lifecycle-independent (cancel/retry in isolation) while a
workflow step is DAG-bound (completion advances downstream jobs). Forcing workflow
steps into `chat_sessions` would overload that table with DAG semantics.

However the **right** shared abstraction already exists in embryo: the `executions`
table.

## Key architectural insight

The `executions` table is the natural canonical "an agent ran with _this_ resolved
config" record. It already:

- Has a `kind` discriminator covering all four paths:
  `workflow_step | workflow_chat | adhoc_chat | subagent`
  (`apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts`).
- References both `chat_session_id` and `workflow_run_id`
  (`apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`).
- Has a state machine + projector
  (`apps/api/src/execution-lifecycle/execution.projector.ts`).
- Is created at dispatch for **all** paths via `ExecutionDispatchService.dispatch()`
  (`apps/api/src/execution-lifecycle/execution-dispatch.service.ts`).
- **Already receives the resolved provider/model** in `DispatchParams.agentConfig`
  — and currently discards them after building the container request.

The transcript is _also_ already unified: both chat and workflow persist conversation
history into `pi_session_trees` (linkable to `workflow_run_id` and/or
`chat_session_id`) via the shared `SessionHydrationService`.

So the only missing piece is persisting the resolved config onto the execution — which
is simultaneously the observability feature **and** the first concrete step of the
architectural unification.

## Target architecture (Initiative B)

Make `executions` the single source of truth for resolved agent config. Relationships:

- **Chat session** = conversation container. Its **executions are the turns**.
  `chat_sessions.execution_id` already points at the current turn — keep.
- **Workflow run** is referenced _by_ executions (`executions.workflow_run_id`,
  one-to-many: a run has many step executions). Keep this direction.
- **Transcript** stays in `pi_session_trees`. No change.

Reframing the instinct: a chat session holds the **requested/default** config; each
execution holds the **resolved actual** config. Per-execution is the truer grain — and
it is the grain workflows need too. Chat only _appeared_ ahead because it stored a
coarse session-level guess.

### Data model — resolved-config + cost columns on `executions`

New columns on `executions`, populated at dispatch (data already present in
`DispatchParams.agentConfig`):

| Column               | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `provider`           | resolved provider name (e.g. `anthropic`)                              |
| `model`              | resolved model id                                                      |
| `agent_profile_id`   | profile that contributed (nullable)                                    |
| `agent_profile_name` | denormalized profile name for display (nullable)                       |
| `harness_id`         | `pi` \| `claude-code` \| … (EPIC-196)                                  |
| `provider_source`    | `global` \| `user` \| `scope` \| `step-override` — _why_ this provider |
| `input_tokens`       | populated at completion from telemetry gateway (fast-follow)           |
| `output_tokens`      | populated at completion from telemetry gateway (fast-follow)           |

**Cost is derived, never stored:** join `executions.model` →
`llm_models.{input_token_cents_per_million, output_token_cents_per_million}`.

`chat_sessions.provider`/`model` are **kept and relabeled** as the session-level
"initial request" (no breaking change). The UI sources _actual_ provider/model from the
execution.

### Events

`event_ledger` has `subagent_execution_id` but no general `execution_id`. Add
`execution_id` to `event_ledger`, stamped at emit. Provider/model on any event row is
then a **join to `executions`** — no payload denormalization, no per-event duplication.

## Web UX

A single reusable **`ProviderModelBadge`** component renders `anthropic · claude-opus-4-8`
(provider icon optional). Hover/expand reveals `agent_profile`, `provider_source`
("step override"), `harness`, and token/cost when present. Placed on:

- **Workflow run detail** — run-level. If a run's executions used mixed models, show
  "multiple" with a per-step breakdown.
- **Step rows / execution sidebar** — the most important current gap.
- **Chat session detail** — actual model per turn (replaces the static session value).
- **Events feed** — a column derived via the join.

Consistent component everywhere serves "at-a-glance transparency", backed by
audit-grade persistence.

## Initiative A — first vertical slice (on the new model)

Narrowest end-to-end vertical that proves B:

1. **Migration:** add all resolved-config columns to `executions` (provider, model,
   agent_profile_id, agent_profile_name, harness_id, provider_source, **and** the
   `input_tokens`/`output_tokens` columns). The token columns ship now but stay null
   until the fast-follow populates them — this avoids a second migration.
2. **Persist** them in `ExecutionDispatchService.dispatch()` (data already in
   `agentConfig`).
3. **API:** `GET /executions/:id` + DTO; embed execution provider/model into the
   existing **workflow-run-detail** response contract.
4. **Web:** `ProviderModelBadge` on **workflow run detail + step rows**.

### Fast-follow (still Initiative A, not the first slice)

- Token columns + populate from telemetry gateway completion event; cost via
  `llm_models` join.
- Switch **chat session detail** to execution-sourced provider/model.
- Add `execution_id` to `event_ledger` + provider/model column in the events feed.

## Out of scope (future B endgame)

Recorded so the boundaries are explicit; **not** required for the slice:

- Folding `subagent_executions` into `executions` (uses `parent_execution_id`, already
  present).
- Removing the legacy synchronous chat dispatch path so _all_ execution flows through
  `ExecutionDispatchService` (guarantees an execution row always exists).

## Decisions made (not asked)

- **Keep `chat_sessions.provider/model`**, relabel as "initial request" rather than
  deleting — avoids a breaking change and preserves the session-level default.
- **Token/cost columns ship in the migration now but are populated as a fast-follow**,
  not in the first slice — keeps the slice tight while avoiding a second migration.

## Constraints

- **Core/Kanban boundary:** all work lives in `apps/api` + `apps/web` + `packages/core`
  contracts. Nothing touches the Kanban domain, so
  `nexus-boundaries/no-core-kanban-residue` is unaffected. Use neutral
  `scopeId`/`contextId` only.
- **Module boundaries:** execution-lifecycle owns the entity + dispatch changes; the
  new read endpoint belongs with execution-lifecycle (or a thin observability
  controller), not dumped into `WorkflowModule`.
- **No lint suppression / TDD:** follow Red-Green-Refactor; new columns and DTO fields
  covered by tests before implementation.

## Success criteria

- A workflow run detail page shows the actual provider+model per step, sourced from a
  persisted execution record (not recomputed).
- `GET /executions/:id` returns resolved provider, model, agent profile, provider
  source, and harness.
- The persisted values match what the container actually ran (verified against an
  end-to-end run).
- No regression to chat-session display; no Kanban-boundary lint violations; unit tests
  green.

## Key file references

- Execution entity: `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`
- Execution kinds: `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts`
- Dispatch: `apps/api/src/execution-lifecycle/execution-dispatch.service.ts`
- Projector: `apps/api/src/execution-lifecycle/execution.projector.ts`
- AI resolution: `apps/api/src/ai-config/ai-configuration.service.ts`
- Step config build: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts`
- Chat session entity: `apps/api/src/chat/database/entities/chat-session.entity.ts`
- Session hydration (shared transcript writer): `apps/api/src/session/session-hydration.service.ts`
- Event ledger: `apps/api/src/observability/event-ledger.service.ts`
- Web run detail: `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`
- Web events feed: `apps/web/src/components/events/EventLedgerFeed.tsx`
- Web run/event types: `apps/web/src/lib/api/types.ts`
