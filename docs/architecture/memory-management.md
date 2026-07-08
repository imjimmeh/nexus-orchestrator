# Memory & Token Distillation Management

The Memory Management system provides agents with long-term persistent memory and manages context window limits through recursive token distillation.

## Architecture

1. **`MemoryManagerService`**
   - Handles persistent storage of facts, preferences, and history segments in PostgreSQL.
   - Scoped by entity (User, Project, System).
   - Supports keyword-based retrieval.

2. **`TokenCounterService`**
   - Uses `tiktoken` (cl100k_base) to accurately calculate token usage for OpenAI and Claude models.
   - Monitors session JSONL trees against 80% threshold limits.

3. **`LLMService`**
   - Integrates with OpenAI `gpt-4o-mini` for cost-effective summarization.
   - Summarizes conversation nodes while preserving critical context.

4. **`DistillationConsumer`**
   - BullMQ worker that processes distillation jobs asynchronously.
   - Implements a recursive strategy: older nodes are compressed more aggressively (30%-70%).
   - Preserves `tool_use` and `tool_result` nodes to maintain agent execution integrity.

## Memory CRUD

Agents can interact with memory via the `query_memory` tool.

- **Entity Types**: User, Project, System.
- **Memory Types**: preference, fact, history.

## Backend Modes (EPIC-061)

Memory retrieval now supports backend selection via `MEMORY_BACKEND`:

1. `postgres` (default): direct `memory_segments` queries.
2. `honcho`: read/query through Honcho API adapter.
3. `dual`: Honcho-first reads with Postgres fallback.

Contract guarantee:

- `query_memory` API/tool schema remains unchanged regardless of backend mode.
- Response normalization preserves `segments[]` shape with `memory_type`, `version`, and timestamp fields.

Operational notes:

- Self-hosted Honcho services are provided in root compose under profile `honcho`.
- Initial rollout remains write-compatible by preserving local Postgres writes while Honcho is introduced for retrieval.

### Transport Ownership

The seven transport-normalization helpers that turn a raw Honcho
response into `IMemorySegment[]` rows (`extractCandidateMessages`,
`readContent`, `normalizeMemoryType`, `parseDate`, `mapCandidate`,
`normalizeHonchoResponse`, and the env-resolving
`unknownMemoryTypePolicy`) used to live as private methods on
`HonchoMemoryBackendService` — smuggled into the backend class
alongside workspace / peer resolution and fallback policy. They
have been relocated to `HonchoClientService` as public static
helpers (with the env-resolver as a private instance method) so
the wire-shape contract lives next to `requestJson` and is
statically importable from tests and future callers. The
backend service shrank by roughly 130 LOC in the process; the
synthesizer and the fetch loop are now on the same class.

`HonchoClientService.listPeerMemory` /
`HonchoClientService.searchPeerMemory` return
`Promise<IMemorySegment[]>` (was `Promise<unknown>`), and the
input `HonchoPeerRequest` carries required `entityType` /
`entityId` fields so the synthesized rows can be attributed to
the caller's provenance scope. The wire-shape interface
(`HonchoRawSegment`), the attribution context
(`HonchoNormalizationContext`), and the typed error class
(`HonchoTransportContractError`, used for the future `'throw'`
opt-in) are now first-class types in
`apps/api/src/memory/honcho-client.{types,errors}.ts`.

Operators who want strict mode (i.e. an unrecognized
`memory_type` from the Honcho response should fail loud
instead of being silently coerced to `'history'`) can set
`HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=throw` — the default
remains `'log-then-history'` so existing deployments are
unaffected, with a single `Logger.warn` line per process per
unrecognized value as the only observable delta. See
[ADR-20260703-honcho-transport-ownership-boundary](decisions/ADR-20260703-honcho-transport-ownership-boundary.md)
for the full decision record.

## Frontend Visibility

Privileged operators can now inspect persisted memory directly in the web UI:

- Project-scoped memory inside the project workspace Memory tab.
- User-scoped memory from the admin Memory Explorer page.
- System/shared memory from the same explorer, with optional `entity_id` filtering for shared buckets.

API routes exposed for the frontend explorer:

- `GET /projects/:projectId/memory/segments`
- `GET /users/:userId/memory/segments`
- `GET /memory/system/segments`

Implementation note:

- Aggregate system queries cannot be satisfied directly by Honcho today because Honcho retrieval is peer-scoped. Those requests fall back to the Postgres-backed memory store while the external API contract stays stable.

## Distillation Strategy

| Node Age (Turns) | Compression Target |
| ---------------- | ------------------ |
| 0-10             | 100% (No change)   |
| 10-20            | 70%                |
| 20-50            | 50%                |
| 50+              | 30%                |

_Note: Tool execution nodes are always preserved at 100%._
_Source: the canonical `DISTILLATION_AGE_BAND_*_MAX_AGE` and `DISTILLATION_TARGET_*_PERCENT` constants in `apps/api/src/memory/distillation.consumer.ts`._

## Built-in Context Provider Bootstrap

> **Architectural decision:** all five canonical providers are now
> wired to real data sources (post-M6 of work item
> `987f5bb5-df32-443d-bd80-b978fa202fae`) and gated on `canProvide`;
> see
> [ADR: Built-in Chat Context Providers — Wire Stubs to Real Data, Gate on `canProvide`](decisions/ADR-built-in-context-provider-stub-wiring.md).
> The registry fail-loud contract below is unchanged.

Chat sessions receive a context preamble assembled by
`ChatSessionContextService` from a registry of pluggable
`IChatContextProvider` implementations (see
[Epic: ChatSessionContextService](../epics/epic-chat-session-context-service.md)).
If a single provider is missing, the memory feedback loop is silently
broken: the agent still gets a context block, but it is missing one
slice of state (e.g. budget, recent failures, project state). To
eliminate that class of silent breakage, the registry is populated
automatically at `MemoryModule` bootstrap by
`BuiltInMemoryContextProvidersModule`.

### Contract

- The five canonical providers are registered automatically on
  `ChatSessionContextService` at `MemoryModule` bootstrap. No runtime
  call is required.
- The provider load order is **deterministic and pinned**:
  `budget` → `recent-task-summary` → `project-state-digest` →
  `last-failure-postmortem` → `user-preference-echo`. Re-ordering
  requires updating the registrar's constructor injection list and
  the `BuiltInContextProviderRegistrar.providersInLoadOrder` getter
  in lockstep; the contract test at
  `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts`
  will fail loudly if they diverge.
- The registrar runs in `OnApplicationBootstrap`, **not**
  `OnModuleInit`. `MemoryModule` and `SessionModule` are both
  `@Global()`, so the order of their `onModuleInit` hooks is not
  strictly guaranteed. `OnApplicationBootstrap` runs after every
  module's `onModuleInit` has finished, which is the safe phase for
  cross-module wiring.

### Providers

| Name                      | Class                           | Priority | Cache TTL (s)         | Source                                                                               |
| ------------------------- | ------------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------ |
| `budget`                  | `BudgetContextProvider`         | 100      | 60                    | `apps/api/src/memory/built-in-context-providers/budget-context.provider.ts`          |
| `recent-task-summary`     | `RecentTaskSummaryProvider`     | 180      | 300                   | `apps/api/src/memory/built-in-context-providers/recent-task-summary.provider.ts`     |
| `project-state-digest`    | `ProjectStateDigestProvider`    | 200      | 300                   | `apps/api/src/memory/built-in-context-providers/project-state-digest.provider.ts`    |
| `last-failure-postmortem` | `LastFailurePostmortemProvider` | 170      | `null` (always fresh) | `apps/api/src/memory/built-in-context-providers/last-failure-postmortem.provider.ts` |
| `user-preference-echo`    | `UserPreferenceEchoProvider`    | 220      | 1800                  | `apps/api/src/memory/built-in-context-providers/user-preference-echo.provider.ts`    |

The four non-budget providers (`recent-task-summary`,
`project-state-digest`, `last-failure-postmortem`,
`user-preference-echo`) were placeholder stubs that emitted
placeholder markdown at real priorities and real TTLs. They are now
wired to real data sources and gate output on `canProvide` returning
`false` when no data exists for the session scope, so the
`ChatContextProviderAdapter` emits `null` for an empty slice instead
of a placeholder block. The per-provider data-source mapping and the
`forwardRef` cycle mitigation are captured in the ADR cross-linked
above.

### Fail-loud contract

Two layers of defence ensure a missing provider can never go
unnoticed:

1. **In-process assertion at bootstrap.** The registrar calls
   `ChatSessionContextService.assertRegistryNonEmpty()` after the
   registration loop. If the registry is empty (e.g. because the
   built-in module failed to bootstrap, or because someone removed
   all providers from its `providers` array), the call throws
   `ChatContextRegistryEmptyError` and **the application fails to
   start**. The error message includes the `contextLabel` (the
   string passed to `assertRegistryNonEmpty`) and the current
   registered count, so triage is straightforward.
2. **HTTP `/health` reports unhealthy.** `ContextProviderHealthIndicator`
   (in `apps/api/src/health/context-provider.health.ts`) calls the
   same `assertRegistryNonEmpty('health-check')` inside a Terminus
   health indicator and is registered in `HealthController`. If the
   registry is empty, `/health` returns HTTP 503 with
   `context-providers: down` in the response body. See the Operations
   section of this doc for the triage playbook.

### Adding a new built-in provider

1. Implement `IChatContextProvider` in a new file under
   `apps/api/src/memory/built-in-context-providers/`. Hard-code the
   `name`, `priority`, and `cacheTtlSeconds` (use `null` for
   "always fresh"). Each provider must be a `@Injectable()` NestJS
   class so it can be registered in a module's `providers` array.
2. Add the new class to the `providers` and `exports` arrays of
   `BuiltInMemoryContextProvidersModule`.
3. Add the new class to the constructor injection list of
   `BuiltInContextProviderRegistrar` **and** to its
   `providersInLoadOrder` getter, in the **same relative position**
   in both lists. This pins the load order.
4. Update the contract test's expected `getRegisteredProviderNames()`
   list to include the new name in the new position.
5. If the new provider depends on services from another module,
   add that module to `BuiltInMemoryContextProvidersModule.imports`.

### Cross-references

- [EPIC-202: Close the AI Self-Improvement Loop](../epics/EPIC-202-close-ai-self-improvement-loop.md)
  (the `34c52b34` wire-up that depends on this bootstrap).
- [Epic: ChatSessionContextService](../epics/epic-chat-session-context-service.md)
  (the original design-of-record for the pluggable context registry).
- `apps/api/src/memory/built-in-context-providers/built-in-context-provider.registrar.ts`
  (the registrar's lifecycle hook).
- `apps/api/src/session/chat-session-context.service.ts`
  (`assertRegistryNonEmpty` / `ChatContextRegistryEmptyError`).
- `apps/api/src/health/context-provider.health.ts`
  (the Terminus health indicator).

## System Prompt Assembly Seam

The system prompt assembly seam provides an extensible, harness-neutral mechanism for accumulating and refining the agent's system prompt across workflow and chat execution paths. Both paths (workflow agent-run and chat session) converge on a shared `SystemPromptAssemblyService` that orchestrates a three-phase pipeline: gather → merge base layers → chain transforms.

### Interface & Lifecycle

Contributors implement `ISystemPromptContributor`, which defines two optional stages:

- **Additive stage** (`contribute`): Return a `PromptContributionBlock` (title + markdown content + priority) to append, or `null` to skip.
- **Transform stage** (`transform`): Receive the fully assembled prompt and return a replacement string, or `null` to pass through unchanged.

Each contributor carries an optional `priority` (default: `DEFAULT_CONTRIBUTOR_PRIORITY = 100`; higher = earlier in the final order) and `timeoutMs` (default: `DEFAULT_CONTRIBUTOR_TIMEOUT_MS = 3000`). All contributors are registered with `SystemPromptAssemblyService` and executed in parallel during gather; transforms are chained sequentially in priority order.

**Context contract** (`PromptAssemblyContext`): Carries harness-neutral identifiers only — `runType` ('workflow' | 'chat'), `harnessId`, `workflowRunId`, `jobId`, `stepId`, `chatSessionId`, `scopeId`, `contextId`, `contextType`, `agentProfileId`, `model`, and `baseLayers` (workflow engine-built layers, populated only on the workflow path). Chat-scoped contexts extend this with a `session` field.

### Three-phase pipeline

1. **Gather** (`gatherBlocks`): Invoke all contributors in parallel (each with its own timeout). Collect returned blocks, catch failures as skipped records, sort survivors by priority (descending) and registration order, and return the sorted list plus applied/skipped names.

2. **Merge base layers** (`assemble`): After gathering, filter and join the base layers (workflow path populates these; chat leaves them empty) and format contributed blocks as Markdown sections (## Title → content). Produce a merged assembled prompt.

3. **Chain transforms** (`applyTransforms`): Sequentially apply contributors with a `transform` method (in priority order) to the merged prompt, each replacing the previous output. Return the final prompt and any transform skips.

Final result (`SystemPromptAssemblyResult`): Includes the assembled `prompt`, the ordered `blocks` array, `applied` contributor names, and `skipped` records (both contribute and transform stage failures).

### Workflow and chat integration

**Workflow path** (`StepSupportService.assembleAgentSystemPrompt`): Calls `systemPromptAssembly.assemble(ctx)` for **all** harnesses (PI, Claude Code, and others). The workflow engine pre-populates `ctx.baseLayers` with the DAG context, policy context, and other engine-controlled sections before the seam runs. Logs skipped contributors at WARN level for operator visibility.

**Chat path** (`ChatSessionContextService`): Registers chat context providers via a `ChatContextProviderAdapter` that bridges `IChatContextProvider` to `ISystemPromptContributor`. The adapter fires only for `runType: 'chat'` and preserves the original error semantics: `canProvide` failures skip the provider; `getContext` failures surface a degraded error block. Chat delegates **block gathering only** to the seam via `gatherBlocks`, then independently applies markdown framing, token-budget bounding (to fit the active model's context window), and message injection. Chat-specific providers do not have access to workflow context fields (`workflowRunId`, `jobId`, etc.) and are no-op'd if the run type is not 'chat'.

### Fail-open behavior

Contributors that timeout or throw errors during the `contribute` stage are skipped without failing the assembly — the system gracefully continues with the survivors. Skipped records log the contributor name, stage, and failure reason. This prevents a single faulty contributor from breaking agent initialization. The `transform` stage is similarly fail-open: a transformer that throws is skipped, and the prompt passes through to the next transformer unchanged.

### Empty-registry divergence

- **Workflow path**: If the registry is empty (no contributors registered), `assemble` returns a no-op result with only the base layers. The workflow proceeds normally with just the engine-built system prompt.
- **Chat path**: If the registry is empty when `ChatSessionContextService` initializes, `BuiltInContextProviderRegistrar.onApplicationBootstrap` throws `ChatContextRegistryEmptyError` and **the application fails to start**. This hard fail ensures chat sessions never receive a degraded context message due to a bootstrap oversight.

### Plugin-kernel bridge

A future follow-up (not yet implemented) will wire plugin-kernel capability contributions through `ISystemPromptContributor`, allowing plugins to inject dynamic capability documentation or override sections of the system prompt. This seam is the designated entry point for that extension.

### References

- `apps/api/src/system-prompt/system-prompt-assembly.service.ts` — Pipeline orchestrator.
- `apps/api/src/system-prompt/system-prompt-contributor.types.ts` — Interface definitions.
- `apps/api/src/system-prompt/system-prompt-assembly.module.ts` — `@Global()` module for shared access.
- `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` — Workflow path integration.
- `apps/api/src/session/chat-session-context.service.ts` — Chat path integration.
- `apps/api/src/session/chat-context-providers/chat-context-provider.adapter.ts` — Chat-to-contributor bridge.

## Operations: chat context provider health

If `/health` returns HTTP 503 with
`context-providers: down` (or the `context-providers` key absent from
the response body), the chat context provider registry is empty.
This means **the application is in a known-broken state** — chat
sessions will not receive the standard context preamble, and the
self-improvement feedback loop is silently broken.

### Triage

1. **Confirm the alert.** Hit `/health` and confirm the
   `context-providers` key is `down`.
2. **Check the application startup logs.** If
   `BuiltInContextProviderRegistrar.onApplicationBootstrap` was
   never logged, the application is currently in a state where
   `MemoryModule` failed to initialize. That is a critical
   startup-time failure that should never have been allowed to
   start the process; treat it as a deployment regression.
3. **Check for `ChatContextRegistryEmptyError` in the logs.** If
   the error was thrown at startup, the application should have
   crashed. If it is in the logs but the process is up, something
   has called `clearProvidersForTesting()` at runtime; that method
   is a test-only escape hatch and must not be called from
   production code paths.
4. **Check the `BuiltInMemoryContextProvidersModule` providers
   array.** If it is empty, that is the regression — the
   `BuiltInMemoryContextProvidersModule` providers list and the
   registrar's constructor injection list must stay in sync.
5. **Restart the application.** The registry is populated at
   bootstrap; runtime recovery is not supported because a chat
   session that ran with an empty registry has already been
   mis-served.

For a deeper operational treatment, see
[`docs/operations/chat-memory-lifecycle-runbook.md`](../operations/chat-memory-lifecycle-runbook.md).
