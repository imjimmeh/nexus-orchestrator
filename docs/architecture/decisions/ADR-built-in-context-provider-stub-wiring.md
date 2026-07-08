# ADR: Built-in Chat Context Providers — Wire Stubs to Real Data, Gate on `canProvide`

**Status:** Accepted
**Date:** 2026-06-26
**Work item:** 987f5bb5-df32-443d-bd80-b978fa202fae
**Owner:** refactor-executor
**Module:** `apps/api/src/memory/built-in-context-providers/`
**Related doc:** `docs/architecture/memory-management.md`

> Status line (literal): `Status: Accepted`

## Context

`ChatSessionContextService` assembles the chat context preamble from a
registry of pluggable `IChatContextProvider` implementations. The
registry is populated automatically at `MemoryModule` bootstrap by
`BuiltInMemoryContextProvidersModule`, and the load order
(`budget` → `recent-task-summary` → `project-state-digest` →
`last-failure-postmortem` → `user-preference-echo`) is contractually
pinned by the spec at
`apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts`.

Of the five canonical providers, **four are placeholder stubs**:

| Provider name             | Source file                                                                                       | State    |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| `budget`                  | `apps/api/src/memory/built-in-context-providers/budget-context.provider.ts`                       | live     |
| `recent-task-summary`     | `apps/api/src/memory/built-in-context-providers/recent-task-summary.provider.ts`                 | stub     |
| `project-state-digest`    | `apps/api/src/memory/built-in-context-providers/project-state-digest.provider.ts`                | stub     |
| `last-failure-postmortem` | `apps/api/src/memory/built-in-context-providers/last-failure-postmortem.provider.ts`             | stub     |
| `user-preference-echo`    | `apps/api/src/memory/built-in-context-providers/user-preference-echo.provider.ts`                | stub     |

The four stubs (`recent-task-summary`, `project-state-digest`,
`last-failure-postmortem`, `user-preference-echo`) all share the same
shape:

- They register at their **real priorities and real TTLs** (180/200/170/220 and 300s/300s/`null`/1800s respectively).
- Their `canProvide()` returns `Promise.resolve(true)` unconditionally — there is no scope-aware signal that says "I have nothing for this session".
- Their `getContext()` returns a hand-written markdown string ("No recent task summary available yet.", "Project state digest pending — see docs/project-context/CAPABILITY_MAP.md.", "No recorded failure postmortem in this session.", "No user preferences recorded for this session.").

That combination pollutes the chat context block list with placeholder
content at production-grade priorities and TTLs. From the agent's
perspective a stub block is indistinguishable from a live one: it has
a title, a priority, a TTL, and prose. Operators have no signal at
runtime that four of the five slices of context are not actually wired
to data — the only signal is the markdown content itself, which the
agent is supposed to act on.

The blast radius is bounded by the fail-loud contract documented in
`docs/architecture/memory-management.md`:

1. **In-process assertion at bootstrap.** `BuiltInContextProviderRegistrar.onApplicationBootstrap`
   calls `ChatSessionContextService.assertRegistryNonEmpty(...)` after
   the registration loop. If the registry is empty (e.g. all
   providers were dropped from the `providers` array, or the
   `BuiltInMemoryContextProvidersModule` failed to bootstrap),
   `ChatContextRegistryEmptyError` is thrown and **the application
   fails to start**.
2. **HTTP `/health` reports unhealthy.** `ContextProviderHealthIndicator`
   (in `apps/api/src/health/context-provider.health.ts`) calls the
   same `assertRegistryNonEmpty('health-check')` inside a Terminus
   health indicator. An empty registry surfaces as HTTP 503 with
   `context-providers: down` in the response body.

These two layers exist specifically to prevent a missing provider from
going unnoticed, which is why the load order is contract-pinned and
the spec will fail loudly if the `providers` array and the
`providersInLoadOrder` getter drift apart. The stubs do not violate
that contract (they still register, still occupy their slot, and
`getRegisteredProviderCount()` still returns 5), but they violate the
**spirit** of it: the contract says "all five slices must be live", and
four of the five are not.

## Decision Drivers

- **Honesty of context payload.** The chat preamble is the agent's
  view of "what does the system already know about this session". A
  placeholder block in that payload is a lie — it claims to carry
  information that does not exist. We want the preamble to contain
  either real data, or no block at all, for each of the five slices.
- **Fail-loud contract integrity.** `assertRegistryNonEmpty` is the
  load-bearing safety net that turns "the registry is empty" into a
  startup crash and a `/health` 503. The contract must remain
  unchanged after this work item — we are not loosening it, we are
  honouring it from a different angle (per-provider real data instead
  of per-provider placeholder).
- **Operator signal.** When all five slices are wired, a missing slice
  is a bug; when a slice is unwired, the bootstrap already has the
  signal. After this work item, an empty slice manifests as "the
  block is absent from the preamble" (because `canProvide` returned
  `false`), which the operator can correlate against the live data
  store. Today the only signal is "the markdown says no".
- **Determinism.** Load order and TTL behaviour are pinned by the
  contract test. The wiring work must not perturb those — the only
  allowed changes are inside the provider bodies (and, transitively,
  the module wiring that lets them reach their data sources).
- **Module-graph discipline.** The `apps/api` module graph is governed
  by `ADR-0001 — API Module Dependency Inversion & forwardRef Policy`.
  Any new edge introduced by wiring providers to data sources must
  follow the same rules: prefer leaf-module inversion, avoid
  `@Global()` and re-exports, and use `forwardRef` only for genuine
  cycles that cannot be broken with an interface or a lazy
  `ModuleRef` resolution.

## Considered Options

### Option 1 — Drop the stubs from the load-order contract test (REJECTED)

Adjust the spec at
`built-in-memory-context-providers.module.spec.ts` so it no longer
asserts that all five canonical providers are present in the
registry. The four stub providers would either be removed from the
`BuiltInMemoryContextProvidersModule.providers` array entirely (so
only `budget` ships in the built-in module), or replaced with
no-ops that throw on `getContext` so the failure surface moves from
"silent placeholder block" to "loud error".

This breaks the fail-loud `assertRegistryNonEmpty` contract documented
in `docs/architecture/memory-management.md`. The contract exists
precisely so that a missing provider cannot reach `/health` 200, and
"the spec no longer asserts five" is exactly the regression vector the
contract is designed to prevent. Even the "throw on `getContext`"
variant weakens the safety net: an empty registry now passes the spec
(only `budget` ships) and `/health` reports healthy with a single
provider, and only the call site of `getContext` observes the failure.
The agent in that case still receives a preamble with `budget` and a
crash trace from the throw, which is a worse experience than the
current placeholder behaviour and strictly less debuggable than the
fail-loud crash the existing contract produces when the registry is
genuinely empty.

The option is rejected on three grounds:

1. **Breaks the fail-loud `assertRegistryNonEmpty` contract.** Removing
   the spec assertion lets an empty registry reach `/health` 200,
   because `assertRegistryNonEmpty` would still pass (the spec would
   no longer encode "expect 5"). The current architecture intentionally
   treats that contract as the canonical regression signal; weakening
   it to make the stubs tolerable inverts the priority.
2. **Weakens the safety nets for adjacent regressions.** The load-order
   contract test catches more than just "all five are present": it
   also catches accidental re-ordering, accidental removal, and
   accidental duplication. Removing the assertion (or replacing it
   with a "count >= 1" form) trades off the load-order guarantee for
   the ability to ship placeholders, which is a bad trade.
3. **Operator signal gets worse, not better.** Today an operator who
   inspects the preamble can identify the four stubs by their content.
   After this option, the stubs are gone — the preamble simply
   contains `budget` and nothing else, and operators who expected a
   project-state digest have no signal at all that the slice was
   removed. A thrown `getContext` looks like a runtime regression,
   not a deliberate "this slice is unwired" decision.

### Option 2 — Wire each stub to a concrete data source; gate output on `canProvide` (CHOSEN)

Keep the five canonical providers and their pinned load order. Wire
each stub provider to a concrete data source and change its
`canProvide()` to return `false` when no data exists for the session
scope, so the `ChatContextProviderAdapter` (in
`apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts`)
emits `null` for that slice instead of a placeholder block. The
underlying `IChatContextProvider` contract is unchanged — the
adapter already skips providers whose `canProvide` returns `false` and
records them as skipped (see
`docs/architecture/memory-management.md` § "System Prompt Assembly
Seam").

This option preserves the fail-loud contract verbatim:

- All five providers still register at bootstrap, so
  `assertRegistryNonEmpty` still passes and the spec still asserts
  exactly five names in the documented order.
- A provider with no live data for the session scope is simply not
  invoked at context-assembly time; it contributes zero blocks to the
  preamble and the assembly logs it as skipped with the reason "no
  data for scope". This is the same path the adapter takes today for
  workflow-specific providers in chat sessions.
- Operators get a positive signal that the slice is wired (the
  provider is present in `getRegisteredProviderNames()`) and a
  per-session signal whether the slice has data for the current
  scope (the skipped/applied log line).

The `canProvide` gating is what makes this honest. A live data source
can legitimately be empty for a given session — `MemoryListingService`
may have no `memoryType='history'` segments for a fresh scope, or
`MemoryManagerService.getStrategicIntentSegment` may legitimately
return `null` for an unseeded project. Returning `false` from
`canProvide` in those cases is the correct semantics: "I have nothing
to contribute for this scope" is not the same as "the registry is
broken", and the adapter must treat them differently.

## Per-provider data source mapping

The four stubs map to the following concrete data sources. Each
provider keeps its existing `name`, `priority`, and `cacheTtlSeconds`;
only its `canProvide` and `getContext` bodies change.

| Provider name             | Data source                                                                                                                       | `canProvide` becomes                                                              | `getContext` body                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `recent-task-summary`     | `MemoryListingService.listSegments({ scopeId, memoryType: 'history' })`                                                          | `listSegments(...).then(segments => segments.length > 0)`                        | Format the N most recent history segments into the markdown block.                                     |
| `project-state-digest`    | `MemoryManagerService.getStrategicIntentSegment(entityType='Project', entityId=scopeId)`                                          | `getStrategicIntentSegment(...).then(segment => segment !== null)`                | Render the strategic-intent segment's content as the digest block.                                     |
| `last-failure-postmortem` | `WorkflowEventRepository` — filter by failure event types (the same source that powers `apps/api/src/workflow/workflow-repair/`) | `repo.findFailureEventsForScope(scopeId).then(events => events.length > 0)`       | Render the most recent failure event's payload as a postmortem block (`cacheTtlSeconds: null` preserved). |
| `user-preference-echo`    | `MemoryListingService.listSegments({ scopeId, memoryType: 'preference' })`                                                        | `listSegments(...).then(segments => segments.length > 0)`                        | Format the preference segments as a stable echo block (TTL 1800s preserved).                           |

The exact `listSegments`/`getStrategicIntentSegment` signatures live in
`apps/api/src/memory/memory-listing.service.ts` and
`apps/api/src/memory/memory-manager.service.ts` (the latter's
`getStrategicIntentSegment` already returns `null` rather than throwing
when no segment exists, which is the right shape for the
`canProvide`-gating pattern). The `WorkflowEventRepository` failure
event query is the same source that the workflow-repair subsystem
reads from; the provider does not introduce a new repository, it
reuses the existing one via the existing `WorkflowCoreModule`
exports. No new persistent state, no new migrations, no new event
types.

## Consequences

### Module-graph cycle — `BuiltInMemoryContextProvidersModule` ↔ `MemoryModule`

The stub providers today depend on nothing — they are leaf providers
in `BuiltInMemoryContextProvidersModule`. After this work item,
`recent-task-summary`, `project-state-digest`, and `user-preference-echo`
need `MemoryListingService` and/or `MemoryManagerService` injected,
and `last-failure-postmortem` needs `WorkflowEventRepository`
injected. `MemoryListingService` and `MemoryManagerService` are
exported by `MemoryModule`. `BuiltInMemoryContextProvidersModule` is
imported by `MemoryModule`.

That introduces a genuine cycle:

```
MemoryModule ── imports ──> BuiltInMemoryContextProvidersModule
   ^                                          │
   │                                          │ imports
   └──────────── imports (services) ──────────┘
```

The chosen resolution is `forwardRef` on both edges of the cycle, to
be applied in milestone M2 of this work item. This is exactly the
pattern documented in `ADR-0001 — API Module Dependency Inversion &
forwardRef Policy`, and is the same pattern that already exists
between `SessionModule` and `TelemetryModule` (see
`apps/api/src/session/session.module.ts` lines 29–30 and
`apps/api/src/telemetry/telemetry.module.ts` line 13). The
`SessionModule` ↔ `TelemetryModule` cycle was ultimately broken via
lazy `ModuleRef` resolution (`ModuleRef({ strict: false })`), but the
initial mitigation was `forwardRef` on both edges — that precedent is
what we are applying here, and the M2 milestone documents it as the
first step on the same path.

`forwardRef` between `MemoryModule` and
`BuiltInMemoryContextProvidersModule` is preferable to the alternative
of extracting `MemoryListingService` and `MemoryManagerService` into
a leaf module, because those services are co-located with the rest of
the memory subsystem (token counter, distillation, eviction reaper,
drift detection) and pulling them out would split the subsystem
across two modules. The leaf extraction would be the right move if
the cycle grew further; for one edge, `forwardRef` matches the
existing precedent and the policy in `ADR-0001`.

### Provider load order and contract test unchanged

The five names, priorities, and TTLs stay byte-for-byte identical.
The contract spec at
`built-in-memory-context-providers.module.spec.ts` does not need to
change for this milestone — it still asserts five names in the
documented order, and the new wiring preserves that. The follow-up
milestones (M3–M6) may add new per-provider tests for the data-source
paths, but those are additive and do not modify the load-order
assertion.

### Adapter skip path is now exercised on every chat session

Today every chat session exercises the "stub returns a placeholder
block" path. After this work item, every chat session instead
exercises the "canProvide returns false → adapter skips" path on the
four rewired providers, until at least one of them has data for the
session scope. This is the intended steady state, and the adapter
already logs skipped providers with the reason, so operators will see
the four providers consistently logged as skipped in sessions with no
prior history. The log volume is bounded (one line per skipped
provider per `gatherBlocks` invocation) and matches the existing
behaviour for workflow-specific providers in chat sessions.

### No changes to public `IChatContextProvider` contract

The interface (`apps/api/src/session/chat-context-providers/chat-context.provider.interface.ts`)
is unchanged. `canProvide` already returns `Promise<boolean>`, and
`getContext` already returns `Promise<ChatContextBlock>`. The adapter
already handles the `canProvide = false` case by skipping the
provider. No external consumer of the interface needs to change.

### Follow-up milestones

M2 wraps both edges of the new cycle in `forwardRef`. M3–M6 rewire
each provider body to its data source in turn. The actual code
changes are deferred to those milestones; M1 is the decision record
only. The verification of the new behaviour (per-provider data fetch,
correct `canProvide` gating, adapter skip semantics) lands in the
follow-up milestones as per-provider spec additions, not in M1.

## Status

Status: Accepted. Owner: refactor-executor.

The provider bodies remain stubs until milestones M3–M6 land; the
decision captured here is that they will be wired to the data sources
above, and that `canProvide` will gate the output so the chat
preamble never carries placeholder content once the wiring is in
place.

## References

- `docs/architecture/memory-management.md` — load-order contract,
  `assertRegistryNonEmpty` documentation, system-prompt assembly seam,
  and `ChatContextProviderAdapter` skip semantics.
- `apps/api/src/memory/built-in-context-providers/` — the five
  provider source files and the registrar / module spec.
- `apps/api/src/memory/built-in-context-providers/built-in-context-provider.registrar.ts` —
  the registrar that enforces the load order at `OnApplicationBootstrap`.
- `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts` —
  the contract test that pins the load order and the
  `assertRegistryNonEmpty` behaviour.
- `apps/api/src/memory/memory-listing.service.ts` — `listSegments`
  with `memoryType: 'history'` and `memoryType: 'preference'`.
- `apps/api/src/memory/memory-manager.service.ts` —
  `getStrategicIntentSegment(entityType, entityId)` (returns `null`
  on no segment).
- `apps/api/src/workflow/database/repositories/workflow-event.repository.ts` —
  failure event source for `last-failure-postmortem`.
- `apps/api/src/session/chat-session-context.service.ts` —
  `assertRegistryNonEmpty` and `ChatContextRegistryEmptyError`.
- `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts` —
  the bridge that translates `canProvide` returns into "skipped"
  records for the assembly seam.
- `apps/api/src/health/context-provider.health.ts` — the Terminus
  health indicator that surfaces the registry-empty condition as
  HTTP 503.
- `ADR-0001 — API Module Dependency Inversion & forwardRef Policy`
  (`docs/architecture/ADR-0001-api-module-dependency-inversion.md`) —
  the module-graph policy that governs the M2 `forwardRef` mitigation.
- `apps/api/src/session/session.module.ts` and
  `apps/api/src/telemetry/telemetry.module.ts` — the existing
  `SessionModule` ↔ `TelemetryModule` `forwardRef` precedent.