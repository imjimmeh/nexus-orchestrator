---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-system-active-todos
outcome: success
inferred_status: missing
confidence_score: 0.93
evidence_refs:
  - apps/api/src/memory/memory.module.ts
  - apps/api/src/session/session.module.ts
  - apps/api/src/session/chat-session-context.service.ts
  - apps/api/src/session/chat-session-context-refresh.listener.ts
  - apps/api/src/session/chat-context-providers/chat-context.provider.interface.ts
  - apps/api/src/session/chat-context-providers/chat-context.types.ts
  - apps/api/src/session/chat-context-providers/index.ts
  - apps/api/src/session/chat-session-context.service.spec.ts
  - apps/api/src/memory/token-counter.service.ts
  - apps/api/src/memory/token-counter.service.spec.ts
  - apps/api/src/memory/distillation.consumer.ts
  - apps/api/src/session/session-hydration.service.ts
  - apps/api/src/session/session-hydration.service.spec.ts
  - apps/api/src/ai-config/ai-configuration.service.ts
  - apps/api/src/ai-config/database/entities/llm-model.entity.ts
  - apps/api/src/memory/learning/learning.module.ts
  - apps/api/src/memory/learning/learning-promotion.service.ts
  - apps/api/src/settings/learning-settings.constants.ts
  - apps/api/src/settings/system-settings.service.ts
  - apps/api/src/chat-execution/chat-execution.service.ts
  - apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts
source_paths:
  - apps/api/src/memory
  - apps/api/src/session
updated_at: 2026-06-15T19:38:21.000Z
---

# Probe Result: Memory System - Active Self-Improvement Loop Todos

## Narrative Summary

All four self-improvement-loop TODO items remain **missing / unimplemented** —
the codebase is essentially identical to the 2026-06-15T00:00:00Z prior probe.
Re-grep confirms no production implementation of `IChatContextProvider`
(only the `index.ts` / `chat-context.types.ts` / `chat-context.provider.interface.ts`
type files exist, plus the `ChatSessionContextService` registration seam).
`TokenCounterService.getTokenLimit` still returns a literal `128000` in both
branches; the per-model `llm_models.token_limit` column is unused by the
counter. `SessionHydrationService.enqueueDistillationIfNeeded` still hardcodes
`0.8` and does not inject `SystemSettingsService`. `LearningPromotionService`
still writes lessons to `memory_segments` (with `source: 'learning_candidate'`
metadata) but no built-in `IChatContextProvider` and no system-prompt merge
step pulls them back into the agent's planning context — they remain reachable
only via the explicit `memory_*` workflow tools
(`apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`).
`SYSTEM_SETTING_DEFAULTS` and `learning-settings.constants.ts` do not list any
`DISTILLATION_*` or `*_threshold` key.

## Capability Updates

### (a) 3e58388a p1 — auto-register built-in memory context providers at MemoryModule bootstrap — MISSING
- `MemoryModule` (`apps/api/src/memory/memory.module.ts:1-72`) registers
  `MemoryManagerService`, `MemoryListingService`, `TokenCounterService`,
  `LLMService`, `DistillationConsumer`, `MemoryBackendFactory`, all
  `*MemoryBackend` services, `HonchoClientService`, `ChatMemoryAdminService`,
  `SystemMemoryController`, and `ChatMemoryAdminController`. It does **not**
  import or provide any `IChatContextProvider` implementation, has no
  `OnModuleInit` hook, and the class body only stores `_moduleName`.
- `SessionModule` (`apps/api/src/session/session.module.ts:1-49`) provides
  `SessionHydrationService`, `JSONLValidationService`, `SessionCleanupService`,
  `ChatSessionContextService`, and `ChatSessionContextRefreshListener`. Its
  class body is `_moduleName` only — no provider registration.
- The only directory with `IChatContextProvider` types is
  `apps/api/src/session/chat-context-providers/` (3 files: `index.ts`,
  `chat-context.provider.interface.ts`, `chat-context.types.ts`).
  Repo-wide search for `implements IChatContextProvider`,
  `extends .*ContextProvider`, or `: IChatContextProvider` returns
  only the interface declaration and the test mocks
  (`apps/api/src/session/chat-session-context.service.spec.ts:34-69`).
  No production class implements the interface.
- `ChatSessionContextService.registerProvider` is only invoked from
  `apps/api/src/session/chat-session-context.service.spec.ts:117-130`
  (project/external/steering/custom mocks) and its own registration
  setter. No production bootstrap path populates `this.providers`.
- Consequence: `ChatSessionContextService.injectContextMessage()` is invoked
  for every chat session start in
  `apps/api/src/chat-execution/chat-execution.service.ts:96-103` (try/catch
  + warn) and runs against an empty `providers` map, so the injected
  system message contains only the static "# Session Context" header with
  no body content. No built-in "memory context" or "promoted lessons"
  block is ever emitted.

### (b) ddfdcead p1 — resolve hardcoded 128k memory token cap with model-aware resolver (R9) — MISSING
- `apps/api/src/memory/token-counter.service.ts:38-45` `getTokenLimit(model)`
  still returns a literal `128000` in both the empty-model and
  non-empty-model branches; the parameter is accepted but never consulted.
- `TokenCounterService` is registered in `MemoryModule` with no dependencies,
  so it has no access to `LlmModelRepository` and could not resolve the
  per-model limit even if it were rewritten.
- The DB schema is unchanged and already supports this:
  `LlmModel.token_limit` (`apps/api/src/ai-config/database/entities/llm-model.entity.ts:21`)
  is an `int` column with a 128000 default, and
  `AiConfigurationService.getTokenLimit(modelName)`
  (`apps/api/src/ai-config/ai-configuration.service.ts:113-119`) already
  returns the per-model value (falling back to 128000). The counter does
  not delegate to or share code with that helper.
- `isOverThreshold` (`apps/api/src/memory/token-counter.service.ts:47-54`)
  multiplies the hardcoded 128000 by the threshold (default 0.8) and is the
  only function called by
  `SessionHydrationService.enqueueDistillationIfNeeded` (line 254), which
  also hardcodes `0.8` at the call site.

### (c) cf917e54 p0 — auto-inject promoted learning lessons into agent planning context — MISSING
- `LearningPromotionService.promoteCandidate`
  (`apps/api/src/memory/learning/learning-promotion.service.ts:225-242`)
  creates a memory segment via `MemoryManagerService.createMemorySegment(...)`
  with `source: 'learning_candidate'`, scope from the candidate, lesson text,
  confidence, and `promotion_policy` metadata. The repository has
  `MemorySegmentRepository.findLearningCandidateSegment` keyed by
  `metadata_json->>'learning_candidate_id'`
  (`apps/api/src/memory/database/repositories/memory-segment.repository.ts`)
  but no other consumer in the agent prompt-rendering pipeline uses it.
- `AiConfigurationService.resolveStepSystemPrompt`
  (`apps/api/src/ai-config/ai-configuration.service.ts:145-159`) composes
  the system prompt from `profile.system_prompt` and
  `params.explicitSystemPrompt`. It does not read `memory_segments`,
  `LearningPromotionService`, or `MemoryListingService`.
- `PromptLoaderService`
  (`apps/api/src/workflow/prompt-loader.service.ts`) only resolves
  workflow YAML or external `prompt_file` content; it does not merge
  promoted lessons. The only references to `learning_candidate_id` in the
  prompt area are in `MemoryToolsHandler` (`memory-tools.handler.ts:9, 24,
  126-127, 131, 151, 224`), which exposes `memory_list` / `memory_search`
  / `promote_candidate` / `record_learning` as explicit workflow tools —
  the agent must call them itself; nothing is auto-injected.
- `ChatSessionContextService` (the only auto-loading context path for
  chat) has no built-in `IChatContextProvider` (see item a), so lessons
  do not reach chat sessions either.
- Net effect: promotion persists lessons but they are only visible to
  agents that explicitly call the `memory_*` workflow tools; no
  auto-injection exists in either the chat or workflow agent planning
  pipeline.

### (d) 3effbfa9 backlog — make session distillation trigger threshold configurable per project / system setting — MISSING
- `SessionHydrationService.enqueueDistillationIfNeeded`
  (`apps/api/src/session/session-hydration.service.ts:242-260`) still calls
  `this.tokenCounter.isOverThreshold(nodes, model, 0.8)` with a hardcoded
  ratio. The service constructor injects
  `ContainerOrchestratorService`, `PiSessionTreeRepository`,
  `ChatSessionRepository`, `JSONLValidationService`, `SecretScannerService`,
  `TokenCounterService`, `AiConfigurationService`, the `distillation` queue,
  `DOCKER_CLIENT`, and `ModuleRef` — `SystemSettingsService` is **not**
  injected.
- `DistillationConsumer` (`apps/api/src/memory/distillation.consumer.ts:1-115`)
  receives `sessionTreeId` + `model` in the job payload and only contains
  the age-tiered-summarization policy (0–10: none, 10–20: 70%, 20–50: 50%,
  50+: 30%); it does not consult any system setting or threshold.
- `apps/api/src/settings/learning-settings.constants.ts` still contains
  only `LEARNING_PROMOTION_MIN_CONFIDENCE_SETTING`.
- `SYSTEM_SETTING_DEFAULTS` in
  `apps/api/src/settings/system-settings.service.ts:57-260` does not list
  any `DISTILLATION_*`, `session_distillation_*`, or
  `*_threshold` key. The closest relatives are
  `chat_session_auto_retry_*` and `workflow_auto_retry_*` (unrelated to
  the hydration trigger). No per-project override path exposes
  distillation either; the `SystemSettingsService.get(key, defaultValue)`
  API supports scoped keys like `rbac_enforcement_mode.__global__`, but
  no distillation key is exposed.
- A repo-wide search across `apps/api/src` for
  `DISTILLATION_THRESHOLD|distillation.*threshold|session.*distill.*setting|distill.*setting`
  returns zero production references. The only `DISTILLATION_*` matches
  are: `DISTILLATION_MODEL` (env var for which model to use, not a
  threshold) and `CHAT_MEMORY_DISTILLATION_TURN_INTERVAL` (chat-memory
  turn interval, env-only and unrelated to the hydration threshold).

## Health Findings

- `ChatSessionContextService` is tested
  (`chat-session-context.service.spec.ts`, 4 describe blocks) but the
  tests register mocks manually. There is no integration test that
  asserts a default built-in provider fires in a Nest testing module,
  and no production code instantiates a provider, so the seam has
  effectively zero behavioral coverage.
- `TokenCounterService` has a 4-case
  `token-counter.service.spec.ts` that does not exercise the
  128k hardcode (only one threshold assertion, with a low
  `0.01` threshold). It does not mock `LlmModelRepository`, so a
  model-aware resolver could be added without breaking existing
  tests.
- `SessionHydrationService` spec covers dehydration/rehydration but
  contains no test for `enqueueDistillationIfNeeded` and no test that
  asserts a system setting can change the threshold. The threshold
  is not asserted anywhere in the test suite, so a regression to
  1.0 or 0.5 would pass CI. `TokenCounterService` is provided as a
  real service (not mocked) in the spec setup.
- `DistillationConsumer` still has no spec file (no
  `distillation.consumer.spec.ts`).
- `LearningPromotionService` is well-tested
  (`learning-promotion.service.spec.ts`), but only for the
  promotion decision flow; no spec asserts that promoted lessons
  reach an agent's planning context.
- No code churn signals were detected in the touched files, but the
  absence of a spec for the consumer and the lack of any built-in
  context provider implementation are the clearest capability gaps.

## Open Questions

- The previous probe (2026-06-15T00:00:00Z) already flagged these as
  open items; this refresh probe confirms no commits in the interim
  closed any of them. Confirm whether the parent workflow expects
  these to be filed as new work items or treated as a deferred
  backlog. The kanban `linked_run_id 6ca65e1e-c8fd-45ef-9461-6cd85094bd28`
  on `ddfdcead` indicates an active attempt at the model-aware token
  cap resolver, but no code in `apps/api/src/memory/token-counter.service.ts`
  or the `ai-config` services reflects that effort.
- The `enqueueDistillationIfNeeded` threshold is per-call (0.8).
  For "per project" configurability, a scope-aware lookup
  (`SystemSettingsService.get<number>('session_distillation_threshold.${projectId}', 0.8)`)
  would mirror the existing `rbac_enforcement_mode.__global__` pattern;
  this design choice is not implied by the existing code.
- A model-aware token limit resolver could either (i) inject
  `LlmModelRepository` into `TokenCounterService` or (ii) delegate to
  `AiConfigurationService.getTokenLimit`. The latter already exists
  and would avoid a second DB round-trip, but the dependency from
  `memory/token-counter.service.ts` into `ai-config` would cross the
  `memory` → `ai-config` direction (currently one-way). Confirm the
  preferred direction.
- "Auto-inject" lessons could be implemented as either a new built-in
  `IChatContextProvider` (covered by item a) or as a system-prompt
  append in `resolveStepSystemPrompt` (covered by item c). These two
  items partially overlap; the report separates them to match the
  parent workflow's question set.
- The `linked_run_id 6ca65e1e-c8fd-45ef-9461-6cd85094bd28` is the
  only external signal that work is in flight for `ddfdcead`; nothing
  in the touched files has changed since the prior probe.
