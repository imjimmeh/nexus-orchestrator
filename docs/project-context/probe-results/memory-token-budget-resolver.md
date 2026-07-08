---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-token-budget-resolver
outcome: success
inferred_status: implemented
confidence_score: 0.96
evidence_refs:
  - apps/api/src/memory/memory-token-budget.resolver.ts
  - apps/api/src/memory/memory-token-budget.resolver.types.ts
  - apps/api/src/memory/memory-token-budget.resolver.spec.ts
  - apps/api/src/memory/memory-token-budget.integration.spec.ts
  - apps/api/src/memory/memory.module.ts
  - apps/api/src/memory/token-counter.service.ts
  - apps/api/src/memory/distillation.consumer.ts
  - apps/api/src/memory/token-counter.service.spec.ts
  - apps/api/src/session/chat-session-context.service.ts
  - apps/api/src/chat/memory/chat-memory-context-assembler.service.ts
  - apps/api/src/session/chat-session-context.service.spec.ts
  - apps/api/src/session/chat-memory-token-budget.integration.spec.ts
  - apps/api/src/session/session-hydration.service.spec.ts
  - apps/api/src/memory/distillation-threshold.bullmq-integration.spec.ts
source_paths:
  - apps/api/src/memory/memory-token-budget.resolver.ts
  - apps/api/src/memory/memory-token-budget.resolver.types.ts
  - apps/api/src/memory/memory-token-budget.resolver.spec.ts
  - apps/api/src/memory/memory-token-budget.integration.spec.ts
updated_at: 2026-06-19T00:30:00Z
---

# Probe Result: Model-Aware Memory Token Budget Resolver (work item ddfdcead)

## Narrative Summary

Work item `ddfdcead` (Model-Aware Memory Token Budget Resolver) is **fully implemented** across the assigned scope and wired into every consumer that previously hardcoded a 128k context-window cap. The resolver replaces the historical "always 128_000 tokens" assumption with a queryable, model-aware budget that slices the active LLM's `token_limit` into `memory` (60%), `working` (30%), and `reserved` (10%) partitions via `AiConfigurationService.getModelForUseCase` + `getTokenLimit`. All four files in the scope exist, contain real code (not stubs), and are exercised by both dedicated unit specs and a full-DI integration spec that asserts the decisive 200k-model bug fix end-to-end.

The implementation is **type-rich, configuration-driven, and defensive**: it has its own typed options contract (`MemoryTokenBudgetOptions` + `MemoryTokenBudgetPercents`), validates percentages at construction time (rejects negatives, NaN, and totals > 100), and falls back to a configurable `fallbackContextWindow` (default 128k) when the active model reports a missing or non-positive limit. The DI factory in `MemoryModule` reads `MEMORY_BUDGET_MEMORY_PERCENT` / `MEMORY_BUDGET_WORKING_PERCENT` / `MEMORY_BUDGET_RESERVED_PERCENT` / `MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` from `ConfigService` with safe `??` coercion (loose `get` is intentional — the API env validation schema does not yet declare these keys).

## Capability Updates

### Primary surface (`apps/api/src/memory/memory-token-budget.resolver.ts`)
- **`MemoryTokenBudgetResolver`** — NestJS `@Injectable` class with private constructor + `static create()` factory. Depends only on `AiConfigurationService` and an options object; no IO, no DB, no `ConfigModule` dependency. Pure async `resolve(): Promise<MemoryTokenBudget>` is cheap to call on every tick.
- **Exported constants** (single source of truth):
  - `DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT = 60`
  - `DEFAULT_MEMORY_BUDGET_WORKING_PERCENT = 30`
  - `DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT = 10`
  - `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW = 128_000`
  - `DEFAULT_MEMORY_BUDGET_USE_CASE: ModelUseCase = 'distillation'`
- **Resolution chain** (`resolveContextWindow`): `getModelForUseCase(useCase)` → `getTokenLimit(modelName)` → if `Number.isFinite && > 0` use it, else warn + return `fallbackContextWindow`. Non-positive / null / NaN limits all fall through the same path; the warn message disambiguates "no active model" from "model with 0 limit configured".
- **Slicing math** (`slice`): `memory = floor(p * contextWindow)`, `working = floor(p * contextWindow)`, `reserved = contextWindow - memory - working`. The reserved slice absorbs any rounding remainder so `memory + working + reserved === contextWindow` for every positive integer window.
- **Construction-time validation** (`assertPercentsValid`): rejects NaN/Infinity and negatives; rejects totals > 100. Throws plain `Error` with a descriptive message.

### Public types (`apps/api/src/memory/memory-token-budget.resolver.types.ts`)
- **`MemoryTokenBudgetPercents`** — `{ memoryPercent, workingPercent, reservedPercent }` (all `readonly number`).
- **`MemoryTokenBudgetOptions`** — `memoryPercent? / workingPercent? / reservedPercent? / fallbackContextWindow? / useCase?` (`useCase` typed as `ModelUseCase` from `../ai-config/database/repositories/llm-model.repository`).
- **`MemoryTokenBudget`** — resolved budget shape with `contextWindow`, `memory`, `working`, `reserved`, plus echoed-back percentages for logging/telemetry attribution. `readonly` throughout.

### Unit tests (`apps/api/src/memory/memory-token-budget.resolver.spec.ts`)
Five `describe` blocks, ~15 test cases:
- **construction**: defaults (`60/30/10` + `distillation` useCase), rejects >100 totals, rejects negatives, rejects NaN.
- **default 60/30/10 slice**: parametric table for 8k / 32k / 128k / 200k / 1M windows with `toMatchObject` + `sum-to-contextWindow` invariant + echoed percentage assertion for each row.
- **128k fallback**: covers `getTokenLimit` returning `null`, `0`, and `-1`; honours custom `fallbackContextWindow` (64k case).
- **configurable percentages**: 70/20/10 slice, sum invariant, and a "tiny percentages" case proving `reserved` absorbs the remainder (200k window with 1/1/1 → memory=2k, working=2k, reserved=196k).
- **useCase wiring**: confirms a `summarization` `useCase` is forwarded to `getModelForUseCase` and that the lookup is driven by that model's `token_limit`.
- Test harness uses a minimal `AiConfigMock` (only `getModelForUseCase` + `getTokenLimit`) and `MemoryTokenBudgetResolver.create()` factory; no NestJS Test module, no DB — pure unit coverage of the resolver contract.

### Integration test (`apps/api/src/memory/memory-token-budget.integration.spec.ts`)
End-to-end NestJS DI module wiring the **real** `MemoryTokenBudgetResolver`, **real** `TokenCounterService`, **real** `MemoryManagerService`, plus mocked `AiConfigurationService` (200k token limit), `MEMORY_BACKEND_TOKEN`, `MemoryMetricsService`, `MetricsService`, and `MemorySegmentRepository` (the last three as no-ops to satisfy the manager's evolved constructor contract from work items `190b3cfc` / `3d7fb798`).
- **`resolver slice`**: asserts the budget is `{ contextWindow: 200_000, memory: 120_000, working: 60_000, reserved: 20_000, ... }` with `memory === 120_000` AND `memory !== 128_000` AND `contextWindow !== 128_000` AND `memory + working + reserved === contextWindow`. This is the explicit bug-fix acceptance criterion from the spec docstring.
- **`TokenCounterService cap`**: `getTokenLimit('claude-sonnet-200k')` returns `200_000`, NOT `128_000`.
- **`isOverThreshold` under a 200k model**: builds a ~120k-token JSONL payload via a deterministic recipe (matches `token-counter.service.spec.ts`), asserts `countJSONLTokens > 102_400 && < 160_000 && < 120_000`, then asserts `isOverThreshold(payload, MODEL_200K, 0.8) === false`. A second test re-implements the OLD `128_000 * 0.8 = 102_400` tripwire inline and asserts the same payload WOULD have tripped it — the decisive evidence of the bug fix. A small-payload control case proves the threshold logic still rejects nothing.
- **`MemoryManagerService path`**: round-trips a memory segment through the manager + mocked backend (smoke test that the DI graph wires without 128k-leakage) and asserts `resolver.resolve().memory === Math.floor(0.6 * tokenCounter.getTokenLimit(MODEL_200K))` — the two sources of truth agree.

### Wiring & module integration
- **`MemoryModule.providers`**: registers `MemoryTokenBudgetResolver` via a `useFactory` that injects `[AiConfigurationService, ConfigService]` and reads the four `MEMORY_BUDGET_*` env vars through `readBudgetOptions(config)` + `readPercent(config, key, fallback)`. The factory uses loose `config.get` and `??` fallback because the API env validation schema does not yet declare these keys.
- **`MemoryModule.exports`**: `MemoryTokenBudgetResolver` is exported so `ChatSessionContextService`, `ChatMemoryContextAssemblerService`, and any downstream NestJS module can inject it.
- **`TokenCounterService`** (`apps/api/src/memory/token-counter.service.ts`): now injects both `AiConfigurationService` and `MemoryTokenBudgetResolver`. `getTokenLimit(model)` first asks the AI config for the model's `token_limit` (returning it when usable), and falls back to `budgetResolver.resolve().contextWindow` otherwise — so the historical 128k magic number is gone from this service. `isOverThreshold` is now async because both sources are awaited. JSDoc explicitly calls out that "the resolver is the single source of truth for the fallback context window (default 128_000 tokens), so this service no longer hardcodes any 128k magic numbers".
- **`DistillationConsumer`** (`apps/api/src/memory/distillation.consumer.ts`): injects `MemoryTokenBudgetResolver` as a constructor dependency; uses `resolveMemoryBudgetSafe()` to wrap every resolution in a try/catch + non-positive-slice check that falls back to a freshly-computed 60/30/10 of `DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW` so the consumer stays non-fatal when the resolver throws (e.g. transient AI config outage).
- **`ChatSessionContextService`** (`apps/api/src/session/chat-session-context.service.ts`): injects `MemoryTokenBudgetResolver` and uses `boundBlocksByMemoryBudget(session, blocks)` to drop the lowest-priority context blocks until the formatted message fits inside `budget.memory`. Single oversized block is kept verbatim. Resolver failures or non-positive slices log a warning and return the unbounded blocks (mirrors the distillation consumer's defensive pattern).
- **`ChatMemoryContextAssemblerService`** (`apps/api/src/chat/memory/chat-memory-context-assembler.service.ts`): injects `MemoryTokenBudgetResolver` as an **optional** dependency (constructor accepts `null`). When the caller does not supply an explicit `tokenBudget`, the service resolves `budgetResolver.resolve().memory` and uses it as the character-budget ceiling (`tokenBudget * 4`). Resolver absent/failure → falls back to the historical `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET` config default (default 600) so older harnesses that haven't migrated to the resolver stay functional.
- **Test surface downstream** (every consumer of the resolver has an updated spec):
  - `apps/api/src/memory/token-counter.service.spec.ts` — `createResolverMock(budget)` helper, ~14 test cases that swap the resolver via `{ provide: MemoryTokenBudgetResolver, useValue: resolver }`.
  - `apps/api/src/memory/distillation-threshold.bullmq-integration.spec.ts` — provides `MemoryTokenBudgetResolver` as `{ useValue }` for the BullMQ integration tests.
  - `apps/api/src/session/chat-session-context.service.spec.ts` — `MemoryTokenBudgetResolver.create(aiCfg)` in the beforeEach; multiple override scenarios (tiny resolver, 200k resolver, throwing resolver) wired through the TestingModule.
  - `apps/api/src/session/chat-memory-token-budget.integration.spec.ts` — dedicated integration spec for the chat session-context path with the resolver; uses the same override pattern.
  - `apps/api/src/session/session-hydration.service.spec.ts` — registers `MemoryTokenBudgetResolver` because `TokenCounterService` depends on it.
  - `apps/api/src/chat/memory/chat-memory-context-assembler.service.spec.ts` — provides a no-op mock for the resolver path.

## Health Findings

- **Test coverage is strong.** Dedicated unit spec (`memory-token-budget.resolver.spec.ts`, ~15 cases across 5 describe blocks) covers construction validation, the parametric slice table for 5 windows (8k → 1M), the 3 fallback paths (null/zero/negative), custom fallback window, configurable percentages, and the useCase wiring. The dedicated DI integration spec (`memory-token-budget.integration.spec.ts`) wires the real resolver through `TokenCounterService` and `MemoryManagerService` to prove the 200k-model bug fix and the resolver/manager agreement.
- **Code quality.** JSDoc on every public method explicitly documents the precedence chain, the fallback semantics ("distinguish 'no active model' from 'model with 128k limit configured'"), and the rounding contract ("memory and working are computed with Math.floor to ensure conservative allocation; reserved absorbs any rounding remainder"). The static `create()` factory is deliberate — it keeps the typed options out of DI while still allowing NestJS to bind the resolver through `useFactory`. The `assertPercentsValid` invariant catches invalid configuration at construction rather than at first `resolve()`.
- **Churn.** Files in scope carry 2026-06-18 mtimes (`memory-token-budget.resolver.ts`, the spec files) consistent with the work item landing. The integration spec carries a 2026-06-19 mtime, indicating a same-day refresh (likely tied to the parallel `190b3cfc`/`3d7fb798` constructor changes). No reverts or churn visible.
- **Backward compatibility.** The 128k default fallback is preserved (`DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`) so any caller that has not been migrated to consume the resolver still observes the historical behaviour. The `useFactory` in `MemoryModule` keeps the percentages optional with `??` defaults, so the resolver is safe to enable without any environment changes.
- **Type safety.** All `readonly` markers on `MemoryTokenBudgetPercents`, `MemoryTokenBudgetOptions`, and `MemoryTokenBudget` prevent mutation after construction. `useCase` is typed as the `ModelUseCase` union from `llm-model.repository`, not a generic `string`, so an invalid use case cannot reach the resolver from TypeScript code.
- **Wiring gaps are intentional and documented.** `ChatMemoryContextAssemblerService` accepts a `null` resolver for back-compat with older test harnesses (explicit JSDoc). `DistillationConsumer.resolveMemoryBudgetSafe` and `ChatSessionContextService.boundBlocksByMemoryBudget` both have defensive try/catch wrappers that preserve historical behaviour when the resolver throws.

## Open Questions

- **ConfigService validation schema not yet declared.** The `readBudgetOptions` helper in `MemoryModule` uses loose `config.get` + `??` coercion because the API env validation schema does not declare `MEMORY_BUDGET_MEMORY_PERCENT` / `MEMORY_BUDGET_WORKING_PERCENT` / `MEMORY_BUDGET_RESERVED_PERCENT` / `MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW`. Promoting these to first-class validated env keys (with a Zod schema entry) is a followup hygiene task — the resolver works without it but operators have no validation feedback for typos.
- **Reserved-slice semantics could be misleading at extreme configurations.** With `memoryPercent=1, workingPercent=1, reservedPercent=1` the integration test asserts `reserved = 196_000` (98%). Operators who think of `reservedPercent` as a hard ceiling on system overhead may be surprised when it silently absorbs the unallocated remainder. A future enhancement could optionally throw or warn when `memoryPercent + workingPercent + reservedPercent < 100` to make the implicit remainder visible. Not a bug today; just a future ergonomic improvement.
- **No dedicated docs entry.** The four files in scope, the `MemoryModule` factory wiring, and the consumer-side defensive wrappers are all well-commented in code, but there is no `docs/architecture/` or `docs/guide/` entry that walks an operator through the new env knobs end-to-end (defaults, valid ranges, interaction with `DistillationThresholdService`, expected values for 8k/128k/200k models). A short guide entry would close that loop and is independent of any code change. **Resolved — see [`docs/guide/memory-token-budget-resolver.md`](../../guide/memory-token-budget-resolver.md) (work item WI-2026-053, `2fffd172-d5a1-41bd-a4d3-ec9c9f7e52c4`). The new operator entry walks through the env knobs, default 60/30/10 slice, worked examples for 8k / 128k / 200k / 1M context windows, fallback semantics, and the R107/R108/R111 followups, and is discoverable from `docs/guide/README.md` (new "Memory platform" section), `AGENTS.md` (Architecture Quirks bullet), and `docs/guide/35-memory-learning.md` (Cross-References "See also" line).**
- **`getModelForUseCase` is the entry point, not `getActiveModel`.** The resolver queries by `useCase` (defaulting to `'distillation'`), so a model change at runtime flows through `AiConfigurationService`'s DB-backed `agent_profiles` table — not through environment variables. Operators expecting env-driven model selection should be pointed at the precedence chain documented in `AGENTS.md` ("Workflow step override → Agent profile → DB default → env fallback"). Not a bug; just a discoverability note worth adding to a docs entry. **Resolved — see the new "How runtime model selection reaches the resolver" subsection in [`docs/guide/memory-token-budget-resolver.md`](../../guide/memory-token-budget-resolver.md) (work item WI-2026-056, `9b3b1563-e167-4a18-b59c-3fd177d464c2`). The new subsection enumerates the four precedence levels (workflow step override → agent profile → DB default model for use case → env fallback) in operator-facing language, cites `AGENTS.md` (AI config precedence section) and the `getModelForUseCase(...)` method on `apps/api/src/ai-config/database/repositories/llm-model.repository.ts` as the entry point, and includes a worked example for swapping the distillation model to a 200k context variant. Also discoverable from `apps/api/README.md` → "Provider Setup" → "Provider References" (cross-link).**