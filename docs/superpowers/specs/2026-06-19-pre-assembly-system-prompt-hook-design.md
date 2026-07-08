# Pre-Assembly System Prompt Hook — Design

- **Date:** 2026-06-19
- **Status:** Approved (design); pending implementation plan
- **Owner:** Jimmeh

## 1. Problem

Today there is **no extension seam that can read or rewrite an agent's system prompt before it is sent to the harness**.

- Workflow agent runs assemble the prompt in `buildAgentSystemPrompt()`
  (`apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts:335`)
  as a hardcoded `.join('\n')` of fixed layers (upstream context, runtime
  context, running-workflows context, promoted-learning context, resolved
  system prompt, optional skill section). There is no interception point, and
  the function **returns early for the `pi` and `claude-code` harnesses**
  (line 380), so even the skill layer is skipped for those engines.
- Chat sessions already have a mature, pluggable system —
  `IChatContextProvider` + `ChatSessionContextService`
  (`apps/api/src/session/chat-session-context.service.ts`) — with a registry,
  deterministic priority ordering, per-provider fail-open with degraded error
  blocks, token-budget bounding, and caching. But it is **chat-only** and
  **additive-only** (it cannot rewrite the prompt), and its applicability and
  block APIs are bound to the `ChatSession` entity.

The existing plugin-kernel `workflow.hook` contributions
(`apps/api/src/plugin-kernel/contributions/plugin-workflow-hook-projection.service.ts`)
fire on **post-execution lifecycle events** and cannot influence prompt
assembly.

## 2. Goal

Introduce a **harness-neutral, pre-assembly system prompt seam** that:

1. Lets in-tree providers **contribute additive context blocks** (generalizing
   today's chat provider pattern), and
2. Lets a **privileged provider transform/override the fully-assembled prompt**.

Scope: **all harnesses on the workflow agent-run path, plus chat sessions**,
behind one shared abstraction. The current chat provider system is refactored to
consume the shared abstraction with **no behavior change** for existing built-in
providers.

This phase delivers the **internal NestJS DI provider seam** only. A
plugin-kernel bridge (exposing the seam to out-of-process plugins) is an
explicit **follow-up**, out of scope here.

## 3. Non-Goals

- No plugin-kernel / out-of-process delivery in this phase.
- No change to the chat token-budget bounding or chat markdown framing
  (stays chat-side post-processing).
- No new kanban/work-item awareness in API/core (boundary preserved).
- Not a mechanism for mutating the prompt mid-run (that is the existing
  steering / `injectMessage` path).

## 4. Core Abstraction

A new harness-/run-type-neutral contributor interface, generalizing
`IChatContextProvider`:

```ts
interface ISystemPromptContributor {
  readonly name: string;
  readonly priority?: number; // higher = earlier; default 100
  readonly timeoutMs?: number; // per-contributor budget; default constant

  /**
   * Additive stage. Read-only over the context. Return a block to append,
   * or null to skip (replaces the chat pattern's canProvide + getContext).
   */
  contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null>;

  /**
   * OPTIONAL privileged override stage. Receives the assembled prompt (base
   * layers + all contributed blocks) and may return a replacement string, or
   * null to pass through unchanged. Transformers are chained in priority order.
   */
  transform?(
    assembled: string,
    ctx: PromptAssemblyContext,
  ): Promise<string | null>;
}

interface PromptContributionBlock {
  title: string;
  content: string; // markdown
  priority: number; // inherited from contributor if omitted
  metadata?: Record<string, unknown>;
}

interface PromptAssemblyContext {
  runType: "workflow" | "chat";
  harnessId?: HarnessId; // 'pi' | 'claude-code' | ...
  // neutral identifiers only — core/kanban boundary
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  chatSessionId?: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
  agentProfileId?: string;
  model?: string;
  // structured view of the engine-built layers so a transformer can
  // inspect/reorder rather than string-parse
  baseLayers: ReadonlyArray<{ id: string; content: string }>;
}
```

## 5. Pipeline — `SystemPromptAssemblyService`

A single aggregator service owns the registry and the pipeline:

1. **Register** contributors at bootstrap (mirrors the existing
   `BuiltInContextProviderRegistrar.onApplicationBootstrap` pattern). Runtime
   registration appended in insertion order.
2. **Contribute (additive, parallel, fail-open):** run every `contribute()`
   under a `Promise.race` timeout (`timeoutMs` → default constant). A
   contributor that throws, times out, or returns `null` is skipped and
   recorded. Surviving blocks are ordered by priority (ascending, tie-broken by
   registration order — same contract as the chat service today).
3. **Merge:** concatenate `baseLayers` + contributed blocks into one string.
4. **Transform (override, chained, priority order):** run each `transform()`
   in priority order; each receives the prior stage's string and returns a
   replacement or `null` (passthrough). Highest-priority transformer effectively
   wins, but they compose. A throwing/timing-out transform is skipped
   (passthrough), never aborts.
5. **Emit** an observability event recording contributors fired/skipped (and
   reasons) for debuggability.

Determinism: priority ascending, tie-broken by registration order, reproducible.

## 6. Integration Points

### 6.1 Workflow path

`buildAgentSystemPrompt()` stops returning a raw string. Instead it builds the
`baseLayers` array (upstream / runtime / running-workflows / promoted-learning /
resolved prompt, with the **skill section as one more base layer**) and calls
`SystemPromptAssemblyService.assemble(ctx)`.

- **Remove the early `return baseSystemPrompt` for `pi`/`claude-code`** (line 380) so the pipeline runs for all harnesses. The skill layer is gated by
  harness exactly as today (only added for non-harness agents) but flows through
  the same assembly call.
- `StepSupportService` (or the helper call site) gets the assembly service
  injected and threaded through like `sessionHydration`.

### 6.2 Chat path

`ChatSessionContextService.getContextBlocks()` delegates block-gathering to the
shared service. Chat **keeps** `boundBlocksByMemoryBudget` (token cap) and
`formatContextMessage` (markdown framing) as chat-side post-processing.
`IChatContextProvider` is refactored to a thin adapter over
`ISystemPromptContributor`, so each existing built-in provider in
`apps/api/src/memory/built-in-context-providers/` keeps its logic unchanged.

### 6.3 Module placement

A new `SystemPromptAssemblyModule` provides `SystemPromptAssemblyService` and is
imported by both `WorkflowStepExecutionModule` and the session module. It uses
the narrowest viable boundary per the Workflow Module Boundaries table; if it
proves workflow-runtime-shaped it lives under
`apps/api/src/workflow/workflow-runtime/`, otherwise as a sibling shared module.

## 7. Failure Handling & Edge Cases

- **Fail-open everywhere** (chosen reliability mode). A buggy contributor or
  transformer never breaks a run.
- **Per-contributor timeout** via `Promise.race`, default constant, overridable
  per contributor.
- **Chat keeps degraded error blocks**; workflow simply omits a failed block.
  Both record the failure in the telemetry event.
- **Empty registry:** the **workflow path treats zero contributors as a valid
  no-op** (base layers only) — assembly must never block a run. **Chat retains
  its existing hard-fail** (`ChatContextRegistryEmptyError`) because a chat
  session with zero providers means the self-improvement loop is silently
  broken.
- **Boundary:** `PromptAssemblyContext` exposes only neutral
  `scopeId`/`contextId`/`contextType`; no kanban/work-item identifiers.
  `nexus-boundaries/no-core-kanban-residue` must stay clean with no allowlists.

## 8. Testing (TDD — Red-Green-Refactor)

Unit / contract specs:

- Deterministic ordering (priority ascending, tie-broken by registration order).
- Fail-open on `contribute()` throw and on timeout.
- Transformer chaining; `null` passthrough; throwing/timing-out transform skipped.
- Privileged override actually replaces assembled content.
- Neutral-field boundary on `PromptAssemblyContext`.
- Workflow early-return removal: `pi` and `claude-code` runs now invoke the
  pipeline.
- Workflow no-op on empty registry vs chat hard-fail preserved.

Regression:

- Existing chat built-in providers produce **byte-identical** output through the
  adapter.
- Existing chat ordering and token-budget contract tests stay green
  (`built-in-memory-context-providers.module.spec.ts`,
  `chat-session-context.service.spec.ts`,
  `chat-memory-token-budget.integration.spec.ts`).

## 9. Follow-ups (out of scope)

- Plugin-kernel bridge: a plugin-backed `ISystemPromptContributor` that delivers
  a new blocking `workflow.prompt.assembling` event to out-of-process plugins.
- Optional config to enable/disable individual contributors per scope.
