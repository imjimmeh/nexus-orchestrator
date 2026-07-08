# Fallback Models / Providers — Design

- **Date:** 2026-06-29
- **Status:** Approved (design); implementation plan pending
- **Author:** Jimmeh (with Claude)

## 1. Problem & Goal

The operator runs against multiple LLM providers, each with its own usage limits.
When the default model hits a usage-limit (or other provider-side failure), work
should automatically continue on the next configured provider/model instead of
failing.

**Goal:** Define an ordered fallback chain — "use `(provider A, model A)` by
default; if it hits a usage limit, switch to `(provider B, model B)`; then `C`;
…" — and have the orchestrator advance through it automatically, then
auto-recover when limits reset.

## 2. Key Decisions (from brainstorming)

| Decision                        | Choice                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where chains are defined        | **Layered**: workflow step override → agent profile → global default chain (mirrors existing AI-config precedence).                                                                               |
| What a chain entry is           | A **`(provider, model)` pair**.                                                                                                                                                                   |
| Triggers that advance the chain | **Usage/quota exhaustion**, **billing exhaustion**, **auth/credential failure**, **provider outage (5xx/529)**.                                                                                   |
| Explicitly _not_ a trigger      | **429 rate-limit** — keep existing back-off-and-retry-same-model behavior.                                                                                                                        |
| Switch mechanism                | **Retry layer / fresh attempt** — the job fails, the repair/retry layer selects the next entry, and the job re-runs from the start in a fresh container. No in-attempt session swap.              |
| Recovery after exhaustion       | **Cooldown with auto-recovery** — the exhausted provider is skipped until a cooldown expires (provider `resetAt` when available, else a configurable per-reason default), then tried first again. |
| Cooldown keying                 | **Per provider, system-global** — usage/billing/auth/outage failures are account/provider-scoped, not model-scoped.                                                                               |
| Cooldown reach                  | **Only jobs that have a configured chain** consult cooldown state. Jobs with no chain behave exactly as today (fully backward-compatible).                                                        |
| Config surface (v1)             | **DB + seed + web UI**.                                                                                                                                                                           |

## 3. Architecture

### 3.1 Existing machinery this builds on

Confirmed during codebase exploration (file paths are anchors, not exhaustive):

- **AI-config resolution:** `apps/api/src/ai-config/ai-configuration.service.ts`
  — `resolveStepSettings()` (precedence: step override → agent profile → scoped
  default → DB default for use case → env fallback) and
  `resolveRunnerProviderConfig()`.
- **Data model:**
  `apps/api/src/ai-config/database/entities/llm-model.entity.ts`,
  `llm-provider.entity.ts`, `agent-profile.entity.ts`,
  and `apps/api/src/security/database/entities/secret-store.entity.ts`.
- **Provider error classification (already exists):**
  - `apps/api/src/llm/provider-terminal-failure.helpers.ts` —
    `classifyProviderTerminalFailure()` returns `provider_usage_exhausted`
    ("out of extra usage"), `provider_billing_exhausted` (402 / insufficient
    balance), `provider_auth_failed` (401/403 / invalid api key).
  - `apps/api/src/llm/provider-transient-failure.helpers.ts` —
    `classifyProviderTransientFailure()` returns `provider_rate_limit_429`,
    `provider_overload_529`, and extracts `resetAt` / usage-limit details.
- **Workflow repair classification:**
  `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts`
  (`classifyProviderFailure()`) and
  `workflow-failure-classification.service.ts`
  (`classifyRunFailure()` orchestrates evidence → class → audit).
- **Execution path:** `step-agent-step-executor.*` →
  `apps/api/src/docker/container-http-client.service.ts` (`executeAgent()` POSTs
  to the container) → `packages/harness-engine-pi` (pi session). Provider errors
  surface in `ContainerAgentResponse.error` and flow back to the step executor.

### 3.2 New data model

**`provider_cooldowns`** (new table) — system-global cooldown registry:

| Column                             | Notes                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `id`                               | PK                                                                                   |
| `provider_name` (or `provider_id`) | The cooled provider. Unique key for the active cooldown.                             |
| `reason`                           | enum: `usage_exhausted` \| `billing_exhausted` \| `auth_failed` \| `provider_outage` |
| `cooled_until`                     | timestamp; `<= now` means recovered                                                  |
| `last_failure_at`                  | timestamp                                                                            |
| `source_run_id`                    | the run that triggered it (observability)                                            |
| timestamps                         | created/updated                                                                      |

This table **is the chain-progress mechanism** — there is no per-job chain index.
Resolution skips cooled providers; a fresh requeue therefore lands on the next
viable entry automatically.

**Chain definitions** (layered):

1. **Workflow step override:** `steps[].inputs.fallback_chain` — inline ordered
   list of `{ provider_name, model_name }`.
2. **Agent profile:** new `agent_profiles.fallback_chain` JSONB column — ordered
   list of `{ provider_name, model_name }` (nullable).
3. **Global default chain:** a `fallback_chains` table (named chains; v1 needs the
   `default` chain) **or** a singleton config row. Ordered list of
   `{ provider_name, model_name }`.

A chain entry references existing `llm_providers` / `llm_models` by name; entries
are validated against active rows at write time (seed/UI) and skipped with a
warning if missing at resolve time.

### 3.3 Resolution (read path)

Extend `AiConfigurationService.resolveStepSettings()`:

1. Compute the **primary** `(provider, model)` exactly as today.
2. Build the **effective chain**: step override → profile → global default. If
   none is configured, the effective chain is `[primary]` and behavior is
   identical to today.
3. Query `provider_cooldowns` for active cooldowns. Select the **first entry
   whose provider is not currently cooled**.
4. If **all** entries are cooled, fall through to the primary anyway (best-effort
   — better to attempt than to refuse) and let it fail normally.

Cooldown is evaluated **lazily at resolution time** (`cooled_until <= now` ⇒
viable), so no background recovery job is required. Expired rows may be swept
opportunistically.

### 3.4 Failure → advance (write path)

In the workflow failure-classification path:

- The existing **terminal** classes `provider_usage_exhausted`,
  `provider_billing_exhausted`, `provider_auth_failed` — currently
  non-retryable — become **retryable-via-fallback** _iff_ the effective chain
  has a not-yet-cooled entry remaining.
- **Provider outage (5xx / 529)** also triggers cooldown + advance.
- **429 rate-limit** remains transient (back off, retry same model) — _not_ a
  fallback trigger.

On a fallback-triggering failure:

1. Upsert a `provider_cooldowns` row for the failing provider. `cooled_until` =
   classifier-extracted `resetAt` when present; otherwise a configurable default
   per reason (initial defaults: outage `2m`; usage/billing/auth `30m`).
2. Requeue the job via a new repair class `provider_fallback_advance`. On
   requeue, resolution (§3.3) naturally lands on the next viable entry.

**Retry budget:** fallback advances must **not** be capped by the normal
`max_retries` budget — a 4-entry chain needs ≥3 advances. Advances are bounded
separately by _remaining viable chain entries_, with a hard ceiling equal to the
chain length to prevent loops.

### 3.5 Termination

When every chain entry's provider is cooled / exhausted (no viable entry and the
best-effort primary attempt also fails), the job hard-fails using the existing
terminal-failure behavior. No new "stuck" states are introduced.

### 3.6 Web UI (apps/web)

- **Chain editor:** edit the global default chain and per-profile chains —
  ordered list with add / remove / reorder, provider and model pickers sourced
  from existing AI-config data.
- **Cooldown status panel (read-only):** which providers are currently cooled,
  the reason, and `cooled_until`.

Follows the web quality gate: presentation in components, side-effects in
hooks/services, React Query keys via the `queryKeys` registry.

## 4. Boundary & Convention Notes

- All new code lives in API/core AI-config and workflow-repair modules and
  `apps/web`. No Kanban domain identifiers introduced (core/Kanban boundary
  preserved).
- New entity + migration follows the `adding-entity-migration` skill (domain-local
  entity/repository, `DatabaseModule` registration, migration authoring).
- Strict lint/typing; no suppressions. Strong types for chain entries and
  cooldown reasons (shared enums/interfaces in `@nexus/core` where consumed
  cross-package).

## 5. Testing Strategy (TDD)

- **Resolution unit tests** (table-driven): all-viable → top entry; top cooled →
  next entry; all cooled → best-effort primary; no chain configured → unchanged.
- **Classifier tests:** each trigger (usage/billing/auth/outage) → advance when
  chain remains, terminal when not; 429 → still retry-same (no advance).
- **Cooldown duration:** `resetAt` honored when present; per-reason default
  otherwise.
- **Loop ceiling:** advances bounded by chain length.
- **Layered precedence:** step > profile > global default chain selection.
- **Web:** component/hook tests for the chain editor and cooldown panel.
- Full API/web suites green before completion.

## 6. Out of Scope (v1 / YAGNI)

- In-attempt (mid-session) model swapping.
- Cooldown affecting jobs that have no configured chain.
- Cost-aware or latency-aware automatic chain ordering (chains are operator-defined).
- Cross-run "circuit breaker" beyond the per-provider cooldown.

## 7. Open Items for the Implementation Plan

- Confirm exact location of the requeue/repair-class wiring and how the effective
  chain is made available to the classifier (it must know remaining viable
  entries to decide retry-via-fallback vs terminal).
- Choose `fallback_chains` table vs singleton config row for the global default.
- Confirm cooldown keying column (`provider_name` vs `provider_id`) against how
  providers are referenced in resolution.
