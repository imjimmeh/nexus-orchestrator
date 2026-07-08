# Memory Token Budget Resolver

> Operator-facing reference for the model-aware memory token budget
> resolver. Work item **WI-2026-053**; resolves probe follow-up **R106**.
> Cross-reference: AGENTS.md → "Architecture Quirks" →
> "AI config precedence"; companion work items **WI-2026-054** (ConfigService
> validation schema) and **WI-2026-055** (R108 reserved-slice semantics).
> Work item **WI-2026-056** extends the "Resolution chain" section
> with the "How runtime model selection reaches the resolver"
> subsection; resolves probe follow-up **R111**.

## Purpose

The memory subsystem historically hardcoded a **128k token cap** for
every model. That single magic number lived inline inside
`TokenCounterService.isOverThreshold` and was also implicit in the
chat-side context assembly. The hardcode produced a concrete bug on
**200k-context models**: any payload above `128_000 × 0.8 = 102_400`
tokens tripped the distillation threshold even when the active model
had `200_000 × 0.8 = 160_000` tokens of headroom. See
`apps/api/src/memory/memory-token-budget.integration.spec.ts` →
"isOverThreshold under a 200k model" for the decisive bug-fix
demonstration (the spec compares a ~120k-token payload against the
old and new tripwires side-by-side).

The resolver exists to fix this once and for all. It is implemented
in `apps/api/src/memory/memory-token-budget.resolver.ts` and exposed
to the rest of the module through
`apps/api/src/memory/memory-token-budget.resolver.types.ts`. It
queries the active LLM model via `AiConfigurationService`, slices the
resolved `contextWindow` into three mutually exclusive partitions
(`memory`, `working`, `reserved`), and emits a `MemoryTokenBudget`
that consumers can read directly without re-implementing the math.

The probe narrative (`docs/project-context/probe-results/memory-token-budget-resolver.md`
→ "No dedicated docs entry") flagged the missing operator documentation
as **R106**. This entry closes that loop without any code change.

## Resolution chain

The resolver walks the same four-tier precedence documented in
**AGENTS.md → "Architecture Quirks" → "AI config precedence"** for
every call:

1. **Workflow step override** (`steps[].inputs.model` / `provider` /
   `agent_profile`).
2. **Agent profile from DB** (`agent_profiles`).
3. **DB default model for use case** (the `distillation` use case by
   default — see `DEFAULT_MEMORY_BUDGET_USE_CASE` in
   `apps/api/src/memory/memory-token-budget.resolver.ts`).
4. **Environment fallback** (`MODEL`, `DISTILLATION_MODEL`,
   `SUMMARIZATION_MODEL`).

Inside the resolver the chain is implemented as
`getModelForUseCase(useCase) → getTokenLimit → fallbackContextWindow`
(see `MemoryTokenBudgetResolver.resolveContextWindow` in
`apps/api/src/memory/memory-token-budget.resolver.ts`):

```text
  getModelForUseCase(useCase)
        │
        ▼
  getTokenLimit(modelName)
        │
        ├── usable limit (>0, finite) ──► return limit
        │
        └── missing / non-positive ──► logger.warn(...) → fallbackContextWindow
                                        (default 128_000 tokens)
```

The `useCase` defaults to `'distillation'` because the memory
subsystem is the primary consumer of the budget. Other modules that
need a different use case should pass
`MemoryTokenBudgetOptions.useCase` explicitly when constructing the
resolver.

When the resolver cannot reach the AI config (transient outage,
DB unavailability, missing model row) it falls back to
`DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` (128_000 tokens)
and emits a structured `logger.warn(...)` so operators can detect
the fallback in the API logs.

### How runtime model selection reaches the resolver

The resolver calls `AiConfigurationService.getModelForUseCase(useCase)`
on every `resolve()`, so the model that drives the budget is whichever
model `AiConfigurationService` returns for the configured `useCase`
(defaulting to `'distillation'`). That call is the entry point that
walks the four-tier AI config precedence chain defined in
[AGENTS.md → "Architecture Quirks" → "AI config precedence"](../../AGENTS.md).
The repository method itself lives in
`apps/api/src/ai-config/database/repositories/llm-model.repository.ts`
as `getModelForUseCase(useCase: ModelUseCase)`; the resolver inherits
the result of that call and then forwards the returned model name to
`getTokenLimit` to read the `contextWindow`.

In operator-facing language, the chain resolves top-to-bottom — the
first level that returns a usable model wins:

1. **Level 1 — Workflow step override.** A specific workflow step can
   pin a model by setting `steps[].inputs.model` / `provider` /
   `agent_profile` in its inputs. This is the highest-priority
   control point: it is per-step, lives in the workflow YAML, and
   overrides every other mechanism. The resolver inherits the
   override transparently because the override is materialised on
   the active model by the time `getModelForUseCase` is called.
2. **Level 2 — Agent profile from DB.** An `agent_profiles` row in
   the DB can bind a specific `llm_models` row to a `use_case` (e.g.
   `use_case='distillation'`, `model_id=<some 200k model>`). This is
   the **typical operator control point** for swapping a model
   without a code change — the swap is a DB row update, not a
   deploy.
3. **Level 3 — DB default model for use case.** The `llm_models`
   table carries a "default for use case" flag (one model per
   `use_case`). The resolver uses this default when no
   `agent_profiles` row is configured for the requested `useCase`.
   This is the system-wide fallback within the DB tier.
4. **Level 4 — Environment fallback.** The `MODEL` /
   `DISTILLATION_MODEL` / `SUMMARIZATION_MODEL` environment
   variables are the last-resort fallback when no DB-driven source
   is configured. They are read by `AiConfigurationService` only
   after the DB tier has no answer.

> **Discoverability note (R111).** Operators expecting an env-driven
> model change should be aware that the resolver's `useCase` key
> (defaulting to `'distillation'`) is what `getModelForUseCase` looks
> up — not the generic "active model". The DB tier (levels 2 + 3) is
> the supported mechanism for runtime swaps; the env vars (level 4)
> are an emergency fallback, not the primary control point.

#### Worked example: swap the distillation model to a 200k context variant

An operator who wants the memory subsystem to use a 200k-context
distillation model (e.g. a `claude-sonnet-200k` row) has four
control points, listed in **priority order** — the first one that
is set wins:

1. **(Highest) Workflow step override** — set `model` in step inputs:
   ```yaml
   steps:
     - id: distill
       type: <distillation step>
       inputs:
         model: claude-sonnet-200k
   ```
   Affects only the steps that set it; useful for per-workflow
   pinning.
2. **Agent profile from DB** — update the `agent_profiles` row for
   `use_case='distillation'` to point at the 200k model. This is
   the standard operator control point: a single DB row update
   flips the default model for every distillation run that does
   not have its own step-level override.
3. **DB default model for use case** — update the `llm_models`
   "default for use case" flag so the 200k model is the default
   for `distillation`. Used when no `agent_profiles` row is
   configured for the use case.
4. **(Lowest) Environment fallback** — set
   `DISTILLATION_MODEL=claude-sonnet-200k` in the API environment.
   Used only when the DB tier has no answer; not the supported
   mechanism for routine swaps.

When the swap is in place, the resolver picks up the new
`contextWindow` (200_000 for the 200k model) on the next
`resolve()` call and produces the
`memory: 120_000, working: 60_000, reserved: 20_000` budget
documented under "Worked examples (8k / 128k / 200k / 1M)" above.

## Default slice

The default 60/30/10 split reserves the majority of the context for
long-term memory recall (60%), a third for working context (recent
turns, tool results, scratchpad — 30%), and a tenth for system /
safety overhead (system prompt, formatting, output headroom — 10%).
The percentages are defined in
`apps/api/src/memory/memory-token-budget.resolver.ts`:

| Slice     | Default constant                          | Value |
| --------- | ----------------------------------------- | ----- |
| Memory    | `DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT`    | 60    |
| Working   | `DEFAULT_MEMORY_BUDGET_WORKING_PERCENT`   | 30    |
| Reserved  | `DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT`  | 10    |

`memory` and `working` are computed with `Math.floor`; `reserved`
absorbs any rounding remainder so the three slices always sum to
exactly `contextWindow`. See "Reserved-slice semantics" below for
the rationale and the R108 ergonomic followup.

### Worked examples (8k / 128k / 200k / 1M)

These are the slices the resolver produces for the four context
windows documented in
`apps/api/src/memory/memory-token-budget.integration.spec.ts`
(the 200k case is asserted verbatim there; the 8k, 128k, and 1M
cases follow the same `Math.floor(0.6×cw) / Math.floor(0.3×cw) /
cw − sum` math and are validated by
`apps/api/src/session/chat-memory-token-budget.integration.spec.ts`):

```text
Context window   →  memory   /  working  / reserved
─────────────────────────────────────────────────────
       8_000     →    4_800  /    2_400  /     800
     128_000     →   76_800  /   38_400  /  12_800
     200_000     →  120_000  /   60_000  /  20_000
   1_000_000     →  600_000  /  300_000  / 100_000
```

The 200k case — `memory: 120_000, working: 60_000, reserved: 20_000` —
is the headline bug-fix result. It replaces the old hardcoded
`128_000 × 0.8 = 102_400` tripwire with a model-aware
`200_000 × 0.8 = 160_000` tripwire, so a ~120k-token payload that
was incorrectly flagged as oversized against the old 128k cap now
fits comfortably on a 200k model. See the integration spec
"resolver slice" describe block for the literal
`expect(budget).toEqual({...})` assertion.

## Env knobs table

All four `MEMORY_BUDGET_*` environment variables are read by the
`readBudgetOptions` factory in `apps/api/src/memory/memory.module.ts`
and surfaced to `MemoryTokenBudgetResolver` via
`MemoryTokenBudgetOptions`. The defaults are exported from
`apps/api/src/memory/memory-token-budget.resolver.ts` so a single
source of truth applies at compile time and at runtime.

| Env var                                  | Default       | Valid range                                  | Description                                                                                                                                                                  |
| ---------------------------------------- | ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEMORY_BUDGET_MEMORY_PERCENT`           | `60`          | `0 ≤ n ≤ 100` (fractional OK; must be finite) | Percentage of the resolved context window reserved for long-term memory recall. Must be finite and non-negative.                                                            |
| `MEMORY_BUDGET_WORKING_PERCENT`          | `30`          | `0 ≤ n ≤ 100` (fractional OK; must be finite) | Percentage of the resolved context window reserved for working context (recent turns, tool results, scratchpad content).                                                       |
| `MEMORY_BUDGET_RESERVED_PERCENT`         | `10`          | `0 ≤ n ≤ 100` (fractional OK; must be finite) | Percentage of the resolved context window reserved for system / safety overhead (system prompt, formatting, output headroom).                                                |
| `MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`  | `128_000`     | Positive integer (tokens)                    | Context window used when the resolver cannot determine the active model's `token_limit` (missing model row, non-positive limit, transient AI-config outage). Preserves the historical 128k hardcoded cap. |

`MemoryTokenBudgetResolver.assertPercentsValid` enforces two
additional constraints at construction time (see
`apps/api/src/memory/memory-token-budget.resolver.ts`):

- Each percentage must be a **finite, non-negative number**.
- The sum of the three percentages must be **100 or less**. (A sum
  below 100 is permitted; the missing percentage is implicitly
  absorbed into `reserved`. See "Reserved-slice semantics" and
  **R108** below.)

The factory uses loose `ConfigService.get(...)` calls with `??`
fallbacks rather than a typed validation schema because the API env
schema does not yet declare these keys. Adding a typed schema is the
subject of work item **WI-2026-054** (followup **R107**).

## Consumer-side defensive wrappers

Every consumer of the resolver treats the resolver as a soft
dependency. When the resolver is absent, throws, or returns a
non-positive memory slice, the consumer logs a warning and falls
back to a documented historical default so the host path stays
non-fatal. The wrappers are:

- **`DistillationConsumer.resolveMemoryBudgetSafe()`** —
  `apps/api/src/memory/distillation.consumer.ts`. Wraps
  `MemoryTokenBudgetResolver.resolve()` in `try`/`catch`; on either
  throw or non-positive `memory`, the method logs a warning and
  re-implements the documented 60/30/10 fallback against
  `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` (128_000 tokens).
  Distillation proceeds unchanged; the resolver-derived budget is
  best-effort.
- **`ChatSessionContextService.boundBlocksByMemoryBudget()`** —
  `apps/api/src/session/chat-session-context.service.ts`. Same
  `try`/`catch` pattern. On failure the method returns the
  **unbounded** `ChatContextBlock[]` so the chat-side `Session
  Context` message ships without a cap rather than crashing the
  chat path. The resolver is injected as a required constructor
  dependency; the wrapper exists to absorb runtime failures.
- **`ChatMemoryContextAssemblerService.resolveTokenBudget()`** —
  `apps/api/src/chat/memory/chat-memory-context-assembler.service.ts`.
  The resolver is injected as an `@Optional()` `@Inject(...)`
  dependency (NestJS optional-DI pattern) so unit tests and older
  harnesses can construct the service without it. When the
  resolver is absent (`null`/`undefined`) the service falls back to
  the documented `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET` config default
  (default **600** tokens); the same fallback applies on resolver
  throw or non-positive memory slice.
- **`TokenCounterService.getTokenLimit()`** —
  `apps/api/src/memory/token-counter.service.ts`. If
  `AiConfigurationService.getTokenLimit(model)` returns a usable
  limit, that value is returned directly; otherwise the service
  delegates to `MemoryTokenBudgetResolver.resolve()` and returns
  `budget.contextWindow`. The hardcoded 128k magic number has been
  removed; the only fallback in the system is the resolver's
  documented `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`.

In every case the fallback slice is exactly `128_000 → memory:
76_800, working: 38_400, reserved: 12_800`, which preserves the
historical pre-resolver behaviour. Operators can therefore roll the
resolver out by region / per `useCase` without changing any consumer
semantics on the failure path.

## Interaction with `DistillationThresholdService`

`DistillationThresholdService` lives at
`apps/api/src/memory/distillation-threshold.service.ts` and resolves
the **live trigger threshold** (the fraction of the model cap that
decides whether to enqueue a distillation run). It does NOT slice
the context window itself — it returns a `(value, source)` tuple
such as `(0.8, 'global-system-setting')`. The resolver and the
threshold service compose at the call site inside
`DistillationConsumer.checkLiveThreshold`:

```text
DistillationConsumer.checkLiveThreshold
   ├─ thresholdService.resolve(sessionTreeId)  → (0.8, 'global-system-setting')
   └─ tokenCounter.isOverThreshold(nodes, model, 0.8)
        ├─ countJSONLTokens(nodes, model)             (sync, unchanged)
        └─ getTokenLimit(model)
              ├─ aiConfig.getTokenLimit(model)        (when usable)
              └─ budgetResolver.resolve().contextWindow  (fallback)
   → count > limit * 0.8
```

Concretely, `TokenCounterService.isOverThreshold` is now `async` and
calls `await this.getTokenLimit(model)`, which in turn awaits the
resolver. The cap therefore scales with the active model:

- **200k model:** `200_000 × 0.8 = 160_000` tokens of headroom
  (was 102_400 under the old 128k hardcode).
- **128k model:** `128_000 × 0.8 = 102_400` tokens (matches the
  historical cap).
- **8k model:** `8_000 × 0.8 = 6_400` tokens (the new behaviour —
  small models no longer get a free 128k window).

The hardcoded `128_000` constant has been removed from
`TokenCounterService`; the only fallback in the resolution chain is
the resolver's `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`.

## Reserved-slice semantics

`reserved` is intentionally computed as
`reserved = contextWindow − memory − working` rather than as its own
`Math.floor(0.1 × contextWindow)` product (see
`MemoryTokenBudgetResolver.slice` in
`apps/api/src/memory/memory-token-budget.resolver.ts`). This is
deliberate: it absorbs the rounding remainder from the `Math.floor`
calls on `memory` and `working` so the three slices always sum to
exactly `contextWindow` for any positive integer window.

Worked example for the 200k case:

```text
memory   = Math.floor(0.60 × 200_000) = 120_000
working  = Math.floor(0.30 × 200_000) =  60_000
reserved = 200_000 − 120_000 − 60_000 = 20_000
        = (0.60 + 0.30 + 0.10) × 200_000  = 200_000  ✓
```

Because the percentages round independently, an operator who configures
e.g. `MEMORY_BUDGET_MEMORY_PERCENT=33`,
`MEMORY_BUDGET_WORKING_PERCENT=33`,
`MEMORY_BUDGET_RESERVED_PERCENT=33` (total = 99) will silently see
the missing 1% land in `reserved` on top of the configured 33%. The
implementation is correct per its documented contract; the contract
is hard to discover.

This is the subject of probe follow-up **R108**. The intended
follow-up work (tracked under **WI-2026-055**, "Memory budget
reserved-slice semantics") either throws on
`memoryPercent + workingPercent + reservedPercent < 100` so the
implicit remainder is made explicit, or warns loudly so operators
see the discrepancy at startup. Either way the change is a
config-validation / ergonomic-warning enhancement; the slicing math
stays the same.

Operators can preview the resolved `(memory, working, reserved)`
tuple at runtime by tailing the `DistillationConsumer` log line
emitted at the start of every distillation run:

```text
Memory budget for active model: <memory> tokens
  (context window: <contextWindow>,
   slice <memoryPercent>/<workingPercent>/<reservedPercent>)
```

If the printed percentages do not sum to 100 the implicit-remainder
warning will surface in a follow-up release — track **WI-2026-055**.

## Related work items / followups

- **WI-2026-053** (this entry) — Add `docs/guide/` entry for the
  model-aware memory token budget resolver covering the
  `MEMORY_BUDGET_*` env knobs. Closes probe follow-up **R106**.
- **WI-2026-054** — Promote the four `MEMORY_BUDGET_*` env keys to
  a typed `ConfigService` validation schema. Closes probe follow-up
  **R107**. Until that schema lands, the resolver relies on the
  loose `ConfigService.get(...)` parsing in
  `apps/api/src/memory/memory.module.ts` → `readBudgetOptions`.
- **WI-2026-055** — Reserved-slice semantics: throw or warn when
  `memoryPercent + workingPercent + reservedPercent < 100` so the
  implicit-remainder behaviour of `reserved = contextWindow −
  memory − working` is made explicit. Closes probe follow-up
  **R108**.
- **WI-2026-056** — Add the "How runtime model selection reaches the
  resolver" subsection under "Resolution chain" above, walking
  operators through the four AI-config precedence levels
  (workflow step override → agent profile → DB default model for
  use case → env fallback) in operator-facing language with a
  worked example for swapping the distillation model to a 200k
  context variant. Closes probe follow-up **R111**.
- **`docs/project-context/probe-results/memory-token-budget-resolver.md`**
  — Source probe narrative that originated R106 / R107 / R108.
- **AGENTS.md → "Architecture Quirks" → "AI config precedence"** —
  The four-tier precedence chain the resolver implements at the
  `getModelForUseCase` boundary.
